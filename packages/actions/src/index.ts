import type {
  ActionBucket,
  ActionObject,
  ActionOutcome,
  ActionStatus,
  ActionType,
  EntityType,
  SuggestedAction,
  Urgency,
} from "@aion/action-core";

export interface CreateActionInput {
  source: string;
  entity_type: EntityType;
  entity_id: string;
  action_type: ActionType;
  title: string;
  reason: string;
  priority?: number;
  urgency?: Urgency;
  suggested_action?: SuggestedAction;
  requires_approval?: boolean;
  due_at?: string | null;
  tags?: string[];
  context_pack_id?: string | null;
}

let seq = 0;

export function createActionId(): string {
  seq += 1;
  return `act_${Date.now().toString(36)}_${seq.toString().padStart(3, "0")}`;
}

export function normalizeCreateInput(input: CreateActionInput): ActionObject {
  const now = new Date().toISOString();
  const requiresApproval = input.requires_approval ?? true;
  const status: ActionStatus = requiresApproval ? "awaiting_approval" : "queued";

  return {
    id: createActionId(),
    source: input.source,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    action_type: input.action_type,
    title: input.title.trim(),
    reason: input.reason.trim(),
    priority: clampPriority(input.priority ?? 50),
    urgency: input.urgency ?? "medium",
    suggested_action: input.suggested_action ?? { channel: "internal" },
    requires_approval: requiresApproval,
    status,
    created_at: now,
    updated_at: now,
    due_at: input.due_at ?? null,
    claimed_by: null,
    claimed_at: null,
    approved_by: null,
    approved_at: null,
    executed_at: null,
    completed_at: null,
    context_pack_id: input.context_pack_id ?? null,
    tags: input.tags ?? [],
    outcome: null,
  };
}

export function clampPriority(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const TERMINAL: ActionStatus[] = ["completed", "failed", "cancelled", "rejected"];

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  if (from === to) return true;
  if (TERMINAL.includes(from)) return false;

  const allowed: Record<ActionStatus, ActionStatus[]> = {
    queued: ["claimed", "awaiting_approval", "approved", "executing", "automated", "cancelled"],
    claimed: ["awaiting_approval", "approved", "executing", "cancelled", "queued"],
    awaiting_approval: ["approved", "rejected", "cancelled", "claimed"],
    approved: ["executing", "automated", "cancelled"],
    rejected: [],
    executing: ["completed", "failed", "cancelled"],
    automated: ["executing", "completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };

  return allowed[from]?.includes(to) ?? false;
}

export function claimAction(action: ActionObject, claimedBy: string): ActionObject {
  if (!canTransition(action.status, "claimed")) {
    throw new Error(`Invalid transition ${action.status} → claimed`);
  }
  const now = new Date().toISOString();
  return {
    ...action,
    status: "claimed",
    claimed_by: claimedBy,
    claimed_at: now,
    updated_at: now,
  };
}

export function approveAction(
  action: ActionObject,
  approvedBy: string,
  approve: boolean
): ActionObject {
  const next: ActionStatus = approve ? "approved" : "rejected";
  if (!canTransition(action.status, next)) {
    throw new Error(`Invalid transition ${action.status} → ${next}`);
  }
  const now = new Date().toISOString();
  return {
    ...action,
    status: next,
    approved_by: approvedBy,
    approved_at: now,
    updated_at: now,
  };
}

export function executeAction(action: ActionObject): ActionObject {
  if (action.requires_approval && action.status !== "approved" && action.status !== "automated") {
    throw new Error("Action requires approval before execution");
  }
  if (
    !["approved", "queued", "claimed", "automated"].includes(action.status) &&
    !canTransition(action.status, "executing")
  ) {
    throw new Error(`Cannot execute action in status ${action.status}`);
  }
  const now = new Date().toISOString();
  return {
    ...action,
    status: "executing",
    executed_at: now,
    updated_at: now,
  };
}

export function completeAction(
  action: ActionObject,
  status: "completed" | "failed" | "cancelled" = "completed"
): ActionObject {
  if (!(action.status === "executing" || action.status === "automated")) {
    throw new Error(`Cannot complete action in status ${action.status}`);
  }
  const now = new Date().toISOString();
  return {
    ...action,
    status,
    completed_at: now,
    updated_at: now,
  };
}

export function recordOutcome(action: ActionObject, outcome: ActionOutcome): ActionObject {
  return {
    ...action,
    outcome,
    updated_at: new Date().toISOString(),
  };
}

export function markAutomated(action: ActionObject): ActionObject {
  if (action.requires_approval && action.status !== "approved") {
    throw new Error("Automated execution still requires prior approval");
  }
  return {
    ...action,
    status: "automated",
    updated_at: new Date().toISOString(),
  };
}

export function attachContextPack(action: ActionObject, contextPackId: string): ActionObject {
  return {
    ...action,
    context_pack_id: contextPackId,
    updated_at: new Date().toISOString(),
  };
}

export function bucketAction(action: ActionObject, now = new Date()): ActionBucket {
  if (["completed", "failed", "cancelled", "rejected"].includes(action.status)) {
    return "completed";
  }
  if (action.status === "automated") {
    return "automated";
  }
  if (action.action_type === "decision" || action.tags?.includes("needs_you")) {
    return "needs_you";
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const due = action.due_at ? new Date(action.due_at) : null;
  const dueToday = due !== null && due >= startOfToday && due <= endOfToday;
  const overdue = due !== null && due < now;

  if (
    action.priority >= 85 ||
    action.urgency === "critical" ||
    (action.urgency === "high" && action.priority >= 75) ||
    overdue
  ) {
    return "now";
  }

  if (dueToday || action.priority >= 70) {
    return "today";
  }

  return "queued";
}

export function groupByBucket(
  actions: ActionObject[],
  now = new Date()
): Record<ActionBucket, ActionObject[]> {
  const groups: Record<ActionBucket, ActionObject[]> = {
    now: [],
    today: [],
    queued: [],
    automated: [],
    needs_you: [],
    completed: [],
  };

  for (const action of actions) {
    groups[bucketAction(action, now)].push(action);
  }

  for (const key of Object.keys(groups) as ActionBucket[]) {
    groups[key].sort((a, b) => b.priority - a.priority);
  }

  return groups;
}

export * from "./schema.js";

