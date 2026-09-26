import type { ActionObject, EventDefinition } from "@aion/action-core";

export type ActionEventName =
  | "action.created"
  | "action.claimed"
  | "action.approved"
  | "action.rejected"
  | "action.executing"
  | "action.completed"
  | "action.failed"
  | "action.outcome_recorded"
  | "action.cancelled"
  | "context.built";

export interface ActionEvent {
  id: string;
  name: ActionEventName;
  actionId: string;
  occurredAt: string;
  actor: string;
  payload: Record<string, unknown>;
}

export type EventListener = (event: ActionEvent) => void | Promise<void>;

export const actionEventDefinitions: EventDefinition[] = [
  {
    name: "action.created",
    description: "A new Action Object entered the queue",
    schema: { type: "object", properties: { action: { type: "object" } } },
  },
  {
    name: "action.claimed",
    description: "An operator or agent claimed an action",
    schema: { type: "object", properties: { claimedBy: { type: "string" } } },
  },
  {
    name: "action.approved",
    description: "Action approved for execution",
    schema: { type: "object", properties: { approvedBy: { type: "string" } } },
  },
  {
    name: "action.rejected",
    description: "Action rejected",
    schema: { type: "object", properties: { approvedBy: { type: "string" } } },
  },
  {
    name: "action.executing",
    description: "Execution started",
    schema: { type: "object" },
  },
  {
    name: "action.completed",
    description: "Action completed successfully",
    schema: { type: "object" },
  },
  {
    name: "action.failed",
    description: "Action failed",
    schema: { type: "object" },
  },
  {
    name: "action.outcome_recorded",
    description: "Outcome metrics attached to an action",
    schema: { type: "object", properties: { outcome: { type: "object" } } },
  },
  {
    name: "action.cancelled",
    description: "Action cancelled",
    schema: { type: "object" },
  },
  {
    name: "context.built",
    description: "Context pack hydrated for an action",
    schema: { type: "object", properties: { contextPackId: { type: "string" } } },
  },
];

let eventSeq = 0;

export function createEventId(): string {
  eventSeq += 1;
  return `evt_${Date.now().toString(36)}_${eventSeq}`;
}

export class ActionEventEmitter {
  private listeners = new Map<ActionEventName | "*", Set<EventListener>>();
  private history: ActionEvent[] = [];

  on(name: ActionEventName | "*", listener: EventListener): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(listener);
    return () => this.listeners.get(name)?.delete(listener);
  }

  async emit(
    name: ActionEventName,
    action: ActionObject,
    actor: string,
    payload: Record<string, unknown> = {}
  ): Promise<ActionEvent> {
    const event: ActionEvent = {
      id: createEventId(),
      name,
      actionId: action.id,
      occurredAt: new Date().toISOString(),
      actor,
      payload: { ...payload, status: action.status, priority: action.priority },
    };
    this.history.push(event);
    const targeted = this.listeners.get(name);
    const wildcard = this.listeners.get("*");
    const all = [...(targeted ?? []), ...(wildcard ?? [])];
    await Promise.all(all.map((listener) => listener(event)));
    return event;
  }

  getHistory(actionId?: string): ActionEvent[] {
    if (!actionId) return [...this.history];
    return this.history.filter((e) => e.actionId === actionId);
  }

  clear(): void {
    this.history = [];
  }
}

export function statusToEventName(status: ActionObject["status"]): ActionEventName | null {
  switch (status) {
    case "claimed":
      return "action.claimed";
    case "approved":
      return "action.approved";
    case "rejected":
      return "action.rejected";
    case "executing":
      return "action.executing";
    case "completed":
      return "action.completed";
    case "failed":
      return "action.failed";
    case "cancelled":
      return "action.cancelled";
    default:
      return null;
  }
}
