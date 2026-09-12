import type { ActionType, Urgency } from "@aion/core";

export interface ScoringSignals {
  urgency?: Urgency;
  actionType?: ActionType;
  hoursStale?: number;
  revenueImpact?: number;
  buyingIntent?: number;
  isBlocking?: boolean;
  requiresCeo?: boolean;
  sourceWeight?: number;
}

const URGENCY_BASE: Record<Urgency, number> = {
  critical: 95,
  high: 80,
  medium: 55,
  low: 30,
};

const ACTION_BOOST: Partial<Record<ActionType, number>> = {
  call: 8,
  follow_up: 6,
  decision: 10,
  deploy: 5,
  approve: 4,
  re_engage: 3,
};

/**
 * Priority scorer for Action Objects (0–100).
 * Producers can pass an explicit priority; this fills gaps from signals.
 */
export function scoreAction(signals: ScoringSignals): number {
  let score = URGENCY_BASE[signals.urgency ?? "medium"];

  if (signals.actionType && ACTION_BOOST[signals.actionType]) {
    score += ACTION_BOOST[signals.actionType]!;
  }

  if (typeof signals.hoursStale === "number") {
    if (signals.hoursStale >= 72) score += 12;
    else if (signals.hoursStale >= 48) score += 8;
    else if (signals.hoursStale >= 24) score += 4;
  }

  if (typeof signals.revenueImpact === "number") {
    score += Math.min(15, Math.round(signals.revenueImpact / 1000));
  }

  if (typeof signals.buyingIntent === "number") {
    score += Math.round(Math.max(0, Math.min(1, signals.buyingIntent)) * 12);
  }

  if (signals.isBlocking) score += 10;
  if (signals.requiresCeo) score += 5;
  if (typeof signals.sourceWeight === "number") {
    score += signals.sourceWeight;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function urgencyFromScore(priority: number): Urgency {
  if (priority >= 90) return "critical";
  if (priority >= 75) return "high";
  if (priority >= 50) return "medium";
  return "low";
}
