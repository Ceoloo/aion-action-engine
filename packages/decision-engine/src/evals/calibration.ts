import { isAutonomousRoute } from '../policy/thresholds.js';
import type { DecisionRecord } from '../telemetry/decision-record.js';

/**
 * Shadow-mode evaluator.
 *
 * The point of running the Decision Plane in shadow first is to earn thresholds
 * from data instead of guessing them. Given a batch of decision records — some
 * carrying ground truth (the actual outcome, or the human decision) — this
 * computes the reliability layer the brief describes: accuracy overall and per
 * confidence bucket, expected calibration error, how often a human disagreed,
 * how often an "auto" route would have been wrong, and the cost/latency saved.
 *
 * Everything here is pure arithmetic over records: no model, no network.
 */
export interface CalibrationBucket {
  lower: number;
  upper: number;
  count: number;
  /** Fraction correct among records in this bucket with ground truth. */
  accuracy: number;
  /** Mean reported confidence in this bucket. */
  meanConfidence: number;
  /** |meanConfidence - accuracy| — the per-bucket calibration gap. */
  gap: number;
}

export interface ShadowReport {
  total: number;
  /** Records that carried ground truth and could be scored. */
  scored: number;
  accuracy: number;
  /** Expected Calibration Error, weighted by bucket population. */
  expectedCalibrationError: number;
  buckets: CalibrationBucket[];
  /** Fraction of records where a human override differed from the decision. */
  humanDisagreementRate: number;
  /**
   * Among decisions routed to an autonomous path (auto_execute*), the fraction
   * whose selected choice disagreed with ground truth — the cost of trusting
   * confidence too much.
   */
  falseAutomationRate: number;
  /** Fraction of all records routed to an autonomous path. */
  autoRouteRate: number;
  /** Autonomous decisions — an estimate of LLM calls avoided by System One. */
  llmCallsAvoided: number;
  latencyP50?: number;
  latencyP95?: number;
  totalCost: number;
}

export interface EvaluateShadowOptions {
  /** Bucket edges in [0, 1]; defaults to deciles from 0.5 up plus 0.95. */
  bucketEdges?: number[];
}

const DEFAULT_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0001];

export function evaluateShadow(
  records: DecisionRecord[],
  options: EvaluateShadowOptions = {},
): ShadowReport {
  const edges = options.bucketEdges ?? DEFAULT_EDGES;
  const total = records.length;

  const scoredRecords = records.filter((r) => r.groundTruth !== undefined);
  const scored = scoredRecords.length;
  const correct = scoredRecords.filter(
    (r) => r.selectedChoice === r.groundTruth,
  ).length;
  const accuracy = scored > 0 ? correct / scored : 0;

  const buckets = buildBuckets(scoredRecords, edges);
  const expectedCalibrationError =
    scored > 0
      ? buckets.reduce((acc, b) => acc + (b.count / scored) * b.gap, 0)
      : 0;

  const overridden = records.filter((r) => r.humanOverride !== undefined);
  const disagreements = overridden.filter(
    (r) => r.humanOverride!.choice !== r.selectedChoice,
  ).length;
  const humanDisagreementRate =
    overridden.length > 0 ? disagreements / overridden.length : 0;

  const autoRecords = records.filter((r) => isAutonomousRoute(r.route));
  const autoRouteRate = total > 0 ? autoRecords.length / total : 0;
  const llmCallsAvoided = autoRecords.length;

  const autoScored = autoRecords.filter((r) => r.groundTruth !== undefined);
  const autoWrong = autoScored.filter(
    (r) => r.selectedChoice !== r.groundTruth,
  ).length;
  const falseAutomationRate =
    autoScored.length > 0 ? autoWrong / autoScored.length : 0;

  const latencies = records
    .map((r) => r.latencyMs)
    .filter((x): x is number => typeof x === 'number')
    .sort((a, b) => a - b);
  const totalCost = records.reduce((acc, r) => acc + (r.cost ?? 0), 0);

  const report: ShadowReport = {
    total,
    scored,
    accuracy,
    expectedCalibrationError,
    buckets,
    humanDisagreementRate,
    falseAutomationRate,
    autoRouteRate,
    llmCallsAvoided,
    totalCost,
  };
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  if (p50 !== undefined) report.latencyP50 = p50;
  if (p95 !== undefined) report.latencyP95 = p95;
  return report;
}

function buildBuckets(
  scoredRecords: DecisionRecord[],
  edges: number[],
): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lower = edges[i]!;
    const upper = edges[i + 1]!;
    const inBucket = scoredRecords.filter(
      (r) => r.confidence >= lower && r.confidence < upper,
    );
    const count = inBucket.length;
    const correct = inBucket.filter(
      (r) => r.selectedChoice === r.groundTruth,
    ).length;
    const acc = count > 0 ? correct / count : 0;
    const meanConf =
      count > 0
        ? inBucket.reduce((a, r) => a + r.confidence, 0) / count
        : (lower + Math.min(upper, 1)) / 2;
    buckets.push({
      lower,
      upper: Math.min(upper, 1),
      count,
      accuracy: acc,
      meanConfidence: meanConf,
      gap: count > 0 ? Math.abs(meanConf - acc) : 0,
    });
  }
  return buckets;
}

function percentile(sorted: number[], q: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  );
  return sorted[idx];
}

/**
 * Segment a batch of records by experiment and run {@link evaluateShadow} on
 * each group. This is how an experiment over routing thresholds becomes
 * measurable: compare accuracy / calibration / false-automation across arms.
 *
 * Records are keyed by BOTH `experimentKey` and `variant` (`"<key> :: <variant>"`)
 * so records from different experiments that happen to share a variant name
 * (e.g. "control") are never pooled — pooling them would make the per-arm
 * metrics describe neither experiment. A record with no experiment key falls
 * under "(none)"; one with no variant under "(control)". Both grouping maps use
 * a null prototype so reserved variant names ("__proto__", "constructor") are
 * ordinary keys, not inherited members that would corrupt the grouping.
 */
export function evaluateShadowByVariant(
  records: DecisionRecord[],
  options: EvaluateShadowOptions = {},
): Record<string, ShadowReport> {
  const groups: Record<string, DecisionRecord[]> = Object.create(null);
  for (const record of records) {
    const key = `${record.experimentKey ?? "(none)"} :: ${record.variant ?? "(control)"}`;
    (groups[key] ??= []).push(record);
  }
  const out: Record<string, ShadowReport> = Object.create(null);
  for (const key of Object.keys(groups)) {
    out[key] = evaluateShadow(groups[key]!, options);
  }
  return out;
}
