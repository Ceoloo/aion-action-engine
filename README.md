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
/packages/connectors      Producers → CreateActionInput (Revenue Copilot, signals, agent recs)
/packages/context         Context Pack Builder — hydrate before execute
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
| `executeAction()` | `POST /v1/actions/:id/execute` *(builds Context Pack first)* |
| `completeAction()` | `POST /v1/actions/:id/complete` |
| `recordOutcome()` | `POST /v1/actions/:id/outcome` |
| `ingestRevenueCopilotEvent()` | `POST /v1/producers/revenue-copilot/events` |
| `buildContext()` | `POST /v1/context/build` |
| `getContextPack()` | `GET /v1/context/:id` |

Headers: `x-aion-actor`, `x-aion-role` (`operator` \| `agent` \| `producer` \| `viewer` \| `admin`), `x-aion-actor-type`.

## Revenue Copilot → Queue

```bash
curl -X POST http://localhost:8787/v1/producers/revenue-copilot/events \
  -H 'content-type: application/json' \
  -H 'x-aion-actor: revenue_copilot' \
  -H 'x-aion-role: producer' \
  -d '{
    "eventType": "application_stalled",
    "leadId": "lead_302",
    "leadName": "James",
    "hoursStale": 48,
    "confidence": 0.9,
    "details": ["Missing bank statements"],
    "draftMessage": "Hi James — quick nudge on the remaining statements."
  }'
```

## Context Pack on execute

`POST /v1/actions/:id/execute` now:

1. Builds a Context Pack for the action’s entity (`identity`, `relationship`, `recent_activity`, `open_commitments`, `applicable_playbooks`, `constraints`, …)
2. Attaches `context_pack_id` to the Action Object
3. Moves status → `executing`
4. Returns `{ action, contextPack }`

That is the hydration layer before Agent OS runs the recommended tool.

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

Run AION itself through this queue for 14 days.

- **First producer:** Revenue Copilot (`POST /v1/producers/revenue-copilot/events`)
- **First consumer:** Operator Console
- **Hydration:** Context Pack Builder on every execute
- **Next on the board:** Agent Execution Inspector, richer live connectors (Supabase / GHL / Notion)
