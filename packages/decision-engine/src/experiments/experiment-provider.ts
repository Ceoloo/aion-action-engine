/**
 * ExperimentProvider — the seam for running experiments over the Decision Plane.
 *
 * It assigns a decision (bucketed by a stable, non-PII unit) to a variant. The
 * DecisionEngine uses the variant to pick threshold overrides and tags every
 * DecisionRecord with the experiment + variant, so the shadow evaluator can
 * measure each variant's accuracy/calibration separately — i.e. prove whether a
 * threshold change actually improved outcomes.
 *
 * Vendor-neutral, exactly like DecisionProvider: PostHog (ADR-010) is one
 * possible provider behind this interface, but the built-in Static/Hash
 * providers work with no backend at all. A remote provider must be backed by a
 * locally-evaluable / bootstrapped flag cache, since assignment is on the hot
 * path and synchronous.
 */
export interface ExperimentContext {
  /** Stable, non-PII bucketing unit (e.g. tenantId or missionId). */
  unit: string;
  tenantId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface ExperimentProvider {
  /** Assigned variant for `experimentKey`, or undefined = control / not enrolled. */
  variant(experimentKey: string, context: ExperimentContext): string | undefined;
}

/**
 * Fixed-assignment provider: explicit unit→variant maps, with an optional
 * default variant per experiment. Deterministic and dependency-free — ideal for
 * tests and hand-pinned rollouts.
 */
export interface StaticExperimentConfig {
  /** experimentKey -> (unit -> variant). */
  assignments?: Record<string, Record<string, string>>;
  /** experimentKey -> default variant when the unit has no explicit assignment. */
  defaults?: Record<string, string>;
}

export class StaticExperimentProvider implements ExperimentProvider {
  private readonly assignments: Record<string, Record<string, string>>;
  private readonly defaults: Record<string, string>;

  constructor(config: StaticExperimentConfig = {}) {
    this.assignments = config.assignments ?? {};
    this.defaults = config.defaults ?? {};
  }

  variant(experimentKey: string, context: ExperimentContext): string | undefined {
    return (
      this.assignments[experimentKey]?.[context.unit] ??
      this.defaults[experimentKey]
    );
  }
}

export interface VariantWeight {
  name: string;
  /** Relative weight; the split is normalized across an experiment's variants. */
  weight: number;
}

export interface HashExperimentConfig {
  /** experimentKey -> weighted variants. */
  experiments: Record<string, VariantWeight[]>;
}

/**
 * Deterministic weighted assignment by hashing `${experimentKey}:${unit}` into
 * [0, 1). The same unit always lands in the same variant (sticky), the split
 * matches the weights over many units, and no backend or randomness is needed.
 */
export class HashExperimentProvider implements ExperimentProvider {
  private readonly experiments: Record<string, VariantWeight[]>;

  constructor(config: HashExperimentConfig) {
    this.experiments = config.experiments ?? {};
  }

  variant(experimentKey: string, context: ExperimentContext): string | undefined {
    const variants = this.experiments[experimentKey];
    if (!variants || variants.length === 0) return undefined;
    const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
    if (total <= 0) return undefined;
    const point = hashUnitInterval(`${experimentKey}:${context.unit}`) * total;
    let acc = 0;
    for (const v of variants) {
      acc += Math.max(0, v.weight);
      if (point < acc) return v.name;
    }
    return variants[variants.length - 1]!.name;
  }
}

/** FNV-1a 32-bit hash of a string, mapped to [0, 1). Stable across runs. */
export function hashUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}
