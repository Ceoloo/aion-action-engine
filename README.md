# AION Action Engine

**Signal → Recommendation → Action Queue → Approval → Execution → Outcome**

Operational module for AION — not another standalone AI app. Producers (Revenue Copilot, Client OS, agents, meetings) emit **Action Objects**. Operators and agents claim, approve, execute, and record outcomes through one governed queue.

Lifecycle: **Prototype** · Buyer: AION internal first · Success metric: ≥80% of meaningful recommendations become tracked actions.

## Monorepo

```
/apps/web                 Operator console (NOW / TODAY / QUEUED / AUTOMATED / NEEDS YOU / COMPLETED)
/packages/core            AionTool interface, ExecutionContext, shared types
/packages/actions         Action Object schema + lifecycle transitions
/packages/events          Structured event bus (action.created → outcome_recorded)
/packages/scoring         Priority scoring from urgency / stale / intent signals
/packages/permissions     Role → permission map for humans and agents
/packages/connectors      Producers → CreateActionInput (Revenue Signal, agent recs)
/services/action-service  HTTP API + SQLite persistence
/db/migrations            Schema
```

Every package is shaped to become a callable tool inside Agent OS / Company OS later:

```ts
interface AionTool<TInput, TOutput> {
  name: string
  version: string
  validate(input: TInput): boolean
  execute(input: TInput, context: ExecutionContext): Promise<TOutput>
  permissions: Permission[]
  events: EventDefinition[]
}
```

## Agent API surface

| Method | Route |
|--------|-------|
| `createAction()` | `POST /v1/actions` |
| `claimAction()` | `POST /v1/actions/:id/claim` |
| `approveAction()` | `POST /v1/actions/:id/approve` |
| `executeAction()` | `POST /v1/actions/:id/execute` |
| `completeAction()` | `POST /v1/actions/:id/complete` |
| `recordOutcome()` | `POST /v1/actions/:id/outcome` |

Headers: `x-aion-actor`, `x-aion-role` (`operator` \| `agent` \| `producer` \| `viewer` \| `admin`), `x-aion-actor-type`.

## Quick start

```bash
pnpm install
pnpm -r --filter=./packages/* build
pnpm db:migrate
pnpm db:seed
pnpm dev          # API :8787 + web :5173
```

Open http://localhost:5173

## Action Object

```json
{
  "id": "act_01",
  "source": "revenue_copilot",
  "entity_type": "lead",
  "entity_id": "lead_302",
  "action_type": "follow_up",
  "title": "Follow up with James about bank statements",
  "reason": "Application incomplete for 48 hours",
  "priority": 91,
  "urgency": "high",
  "suggested_action": { "channel": "sms", "message": "..." },
  "requires_approval": true,
  "status": "awaiting_approval",
  "created_at": "..."
}
```

## Validation plan

Run AION itself through this queue for 14 days. First producer: **Revenue Copilot**. First consumer: **Operator Console**. Next infrastructure modules on the board: Context Pack Builder, Agent Execution Inspector, Revenue Signal Engine.
