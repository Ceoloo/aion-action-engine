export type ActionBucket =
  | "now"
  | "today"
  | "queued"
  | "automated"
  | "needs_you"
  | "completed";

export interface SuggestedAction {
  channel: string;
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
  entity_type: string;
  entity_id: string;
  action_type: string;
  title: string;
  reason: string;
  priority: number;
  urgency: string;
  suggested_action: SuggestedAction;
  requires_approval: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
  claimed_by?: string | null;
  approved_by?: string | null;
  tags?: string[];
  outcome?: ActionOutcome | null;
}

export interface BucketResponse {
  buckets: Record<ActionBucket, ActionObject[]>;
  counts: Record<ActionBucket, number>;
}

const headers = {
  "Content-Type": "application/json",
  "x-aion-actor": "operator",
  "x-aion-role": "operator",
};

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return body as T;
}

export async function fetchBuckets(): Promise<BucketResponse> {
  return parse(await fetch("/v1/actions/buckets"));
}

export async function approveAction(id: string, approve = true): Promise<ActionObject> {
  const data = await parse<{ action: ActionObject }>(
    await fetch(`/v1/actions/${id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ approve }),
    })
  );
  return data.action;
}

export async function executeAction(id: string): Promise<ActionObject> {
  const data = await parse<{ action: ActionObject }>(
    await fetch(`/v1/actions/${id}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
  );
  return data.action;
}

export async function claimAction(id: string): Promise<ActionObject> {
  const data = await parse<{ action: ActionObject }>(
    await fetch(`/v1/actions/${id}/claim`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
  );
  return data.action;
}

export async function completeAction(id: string): Promise<ActionObject> {
  const data = await parse<{ action: ActionObject }>(
    await fetch(`/v1/actions/${id}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "completed" }),
    })
  );
  return data.action;
}
