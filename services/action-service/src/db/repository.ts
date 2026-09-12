import type { ActionObject, ActionOutcome, SuggestedAction } from "@aion/core";
import type { ActionEvent } from "@aion/events";
import type Database from "better-sqlite3";

interface ActionRow {
  id: string;
  source: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  title: string;
  reason: string;
  priority: number;
  urgency: string;
  suggested_action_json: string;
  requires_approval: number;
  status: string;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
  context_pack_id: string | null;
  tags_json: string;
  outcome_json: string | null;
}

function rowToAction(row: ActionRow): ActionObject {
  return {
    id: row.id,
    source: row.source,
    entity_type: row.entity_type as ActionObject["entity_type"],
    entity_id: row.entity_id,
    action_type: row.action_type as ActionObject["action_type"],
    title: row.title,
    reason: row.reason,
    priority: row.priority,
    urgency: row.urgency as ActionObject["urgency"],
    suggested_action: JSON.parse(row.suggested_action_json) as SuggestedAction,
    requires_approval: Boolean(row.requires_approval),
    status: row.status as ActionObject["status"],
    created_at: row.created_at,
    updated_at: row.updated_at,
    due_at: row.due_at,
    claimed_by: row.claimed_by,
    claimed_at: row.claimed_at,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    executed_at: row.executed_at,
    completed_at: row.completed_at,
    context_pack_id: row.context_pack_id,
    tags: JSON.parse(row.tags_json) as string[],
    outcome: row.outcome_json ? (JSON.parse(row.outcome_json) as ActionOutcome) : null,
  };
}

export class ActionRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(action: ActionObject): ActionObject {
    this.db
      .prepare(
        `INSERT INTO actions (
          id, source, entity_type, entity_id, action_type, title, reason,
          priority, urgency, suggested_action_json, requires_approval, status,
          created_at, updated_at, due_at, claimed_by, claimed_at, approved_by,
          approved_at, executed_at, completed_at, context_pack_id, tags_json, outcome_json
        ) VALUES (
          @id, @source, @entity_type, @entity_id, @action_type, @title, @reason,
          @priority, @urgency, @suggested_action_json, @requires_approval, @status,
          @created_at, @updated_at, @due_at, @claimed_by, @claimed_at, @approved_by,
          @approved_at, @executed_at, @completed_at, @context_pack_id, @tags_json, @outcome_json
        )
        ON CONFLICT(id) DO UPDATE SET
          source=excluded.source,
          entity_type=excluded.entity_type,
          entity_id=excluded.entity_id,
          action_type=excluded.action_type,
          title=excluded.title,
          reason=excluded.reason,
          priority=excluded.priority,
          urgency=excluded.urgency,
          suggested_action_json=excluded.suggested_action_json,
          requires_approval=excluded.requires_approval,
          status=excluded.status,
          updated_at=excluded.updated_at,
          due_at=excluded.due_at,
          claimed_by=excluded.claimed_by,
          claimed_at=excluded.claimed_at,
          approved_by=excluded.approved_by,
          approved_at=excluded.approved_at,
          executed_at=excluded.executed_at,
          completed_at=excluded.completed_at,
          context_pack_id=excluded.context_pack_id,
          tags_json=excluded.tags_json,
          outcome_json=excluded.outcome_json`
      )
      .run({
        id: action.id,
        source: action.source,
        entity_type: action.entity_type,
        entity_id: action.entity_id,
        action_type: action.action_type,
        title: action.title,
        reason: action.reason,
        priority: action.priority,
        urgency: action.urgency,
        suggested_action_json: JSON.stringify(action.suggested_action),
        requires_approval: action.requires_approval ? 1 : 0,
        status: action.status,
        created_at: action.created_at,
        updated_at: action.updated_at,
        due_at: action.due_at ?? null,
        claimed_by: action.claimed_by ?? null,
        claimed_at: action.claimed_at ?? null,
        approved_by: action.approved_by ?? null,
        approved_at: action.approved_at ?? null,
        executed_at: action.executed_at ?? null,
        completed_at: action.completed_at ?? null,
        context_pack_id: action.context_pack_id ?? null,
        tags_json: JSON.stringify(action.tags ?? []),
        outcome_json: action.outcome ? JSON.stringify(action.outcome) : null,
      });
    return action;
  }

  getById(id: string): ActionObject | null {
    const row = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id) as
      | ActionRow
      | undefined;
    return row ? rowToAction(row) : null;
  }

  list(): ActionObject[] {
    const rows = this.db
      .prepare("SELECT * FROM actions ORDER BY priority DESC, created_at ASC")
      .all() as ActionRow[];
    return rows.map(rowToAction);
  }

  insertEvent(event: ActionEvent): void {
    this.db
      .prepare(
        `INSERT INTO action_events (id, name, action_id, occurred_at, actor, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.name,
        event.actionId,
        event.occurredAt,
        event.actor,
        JSON.stringify(event.payload)
      );
  }

  listEvents(actionId?: string): ActionEvent[] {
    const rows = actionId
      ? (this.db
          .prepare("SELECT * FROM action_events WHERE action_id = ? ORDER BY occurred_at ASC")
          .all(actionId) as Array<{
          id: string;
          name: string;
          action_id: string;
          occurred_at: string;
          actor: string;
          payload_json: string;
        }>)
      : (this.db
          .prepare("SELECT * FROM action_events ORDER BY occurred_at ASC")
          .all() as Array<{
          id: string;
          name: string;
          action_id: string;
          occurred_at: string;
          actor: string;
          payload_json: string;
        }>);

    return rows.map((r) => ({
      id: r.id,
      name: r.name as ActionEvent["name"],
      actionId: r.action_id,
      occurredAt: r.occurred_at,
      actor: r.actor,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    }));
  }
}
