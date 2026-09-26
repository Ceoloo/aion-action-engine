/**
 * AION Action Core — shared contracts for the Action Engine workspace.
 *
 * Deliberately NOT named `@aion/core`: that name belongs to the canonical
 * control-plane kernel (Ceoloo/aion-core). Governed side effects go through
 * the Runtime Execution Gateway, never through this package.
 *
 * Every service exposes: inputSchema, execute(), eventEmitter, outputSchema
 * via AionTool so Agent OS can call it later.
 */

export type Permission =
  | "actions:create"
  | "actions:read"
  | "actions:claim"
  | "actions:approve"
  | "actions:execute"
  | "actions:complete"
  | "actions:outcome"
  | "actions:admin"
  | "context:build"
  | "context:read";

export interface ExecutionContext {
  actor: string;
  actorType: "human" | "agent" | "system";
  requestId: string;
  permissions: Permission[];
  now: Date;
  metadata?: Record<string, unknown>;
}

export interface EventDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface AionTool<TInput, TOutput> {
  name: string;
  version: string;
  validate(input: TInput): boolean;
  execute(input: TInput, context: ExecutionContext): Promise<TOutput>;
  permissions: Permission[];
  events: EventDefinition[];
}

export type EntityType =
  | "lead"
  | "client"
  | "deal"
  | "project"
  | "content"
  | "deploy"
  | "decision"
  | "agent"
  | "other";

export type ActionType =
  | "follow_up"
  | "call"
  | "review"
  | "approve"
  | "generate"
  | "send"
  | "update_crm"
  | "deploy"
  | "onboard"
  | "decision"
  | "re_engage"
  | "other";

export type Urgency = "critical" | "high" | "medium" | "low";

export type ActionStatus =
  | "queued"
  | "claimed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "automated"
  | "completed"
  | "failed"
  | "cancelled";

export type ActionBucket =
  | "now"
  | "today"
  | "queued"
  | "automated"
  | "needs_you"
  | "completed";

export type ActionChannel =
  | "sms"
  | "email"
  | "call"
  | "slack"
  | "crm"
  | "web"
  | "agent"
  | "internal";

export interface SuggestedAction {
  channel: ActionChannel;
  message?: string;
  tool?: string;
  payload?: Record<string, unknown>;
}

export interface ActionOutcome {
  result: "success" | "partial" | "failed" | "skipped";
  notes?: string;
  metrics?: Record<string, number>;
  recordedAt: string;
  recordedBy: string;
}

export interface ActionObject {
  id: string;
  source: string;
  entity_type: EntityType;
  entity_id: string;
  action_type: ActionType;
  title: string;
  reason: string;
  priority: number;
  urgency: Urgency;
  suggested_action: SuggestedAction;
  requires_approval: boolean;
  status: ActionStatus;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  completed_at?: string | null;
  context_pack_id?: string | null;
  tags?: string[];
  outcome?: ActionOutcome | null;
}

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createExecutionContext(
  partial: Omit<ExecutionContext, "requestId" | "now"> & {
    requestId?: string;
    now?: Date;
  }
): ExecutionContext {
  return {
    ...partial,
    requestId: partial.requestId ?? createRequestId(),
    now: partial.now ?? new Date(),
  };
}
