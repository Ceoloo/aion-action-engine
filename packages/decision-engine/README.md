# @aion/decision-engine

The **AION Decision Plane** — a vendor-neutral "System One" layer for fast, typed,
calibrated judgments (route / score / verify). It decides *what* should happen so
that generative models (Claude / GPT / Grok) can focus on creating and
communicating, and the AION policy engine + Execution Gateway decide what is
*allowed* to happen.

```
State / Context ──▶ DECISION PLANE ──▶ confidence ──▶ fast path | reasoning LLM | human
                    (provider)                         └────────▶ Execution Gateway ──▶ tools
```

## Why

Most stacks run a large generative model for every small decision:
`state → reasoning → tokens → text/JSON → parse → validate → action`.
The Decision Plane collapses that to `state → typed decision + probability → route`.
A provider structurally **cannot** invent an out-of-space output — but a valid
output is not a correct decision, so confidence is treated as a *signal*, never
permission.

## Pieces

| Module | What it does |
|---|---|
| `schemas/` | The typed decision space: `binary` / `choice` / `score` questions & results, plus `assertResultValid` (the structural guarantee). |
| `providers/` | The `DecisionProvider` seam and three implementations: `RulesProvider` (deterministic baseline), `LLMDecisionProvider` (System-Two judge seam), `TypeSafeJevProvider` (System-One; inert until credentials are supplied). |
| `policy/` | `routeDecision(confidence, risk)` → `auto_execute` / `auto_execute_low_risk` / `llm_verify` / `reasoning` / `human_approval`. High-risk always routes to a human. |
| `telemetry/` | The immutable `DecisionRecord` (+ `hashState`) that fills the reliability ledger. |
| `evals/` | `evaluateShadow(records)` → accuracy per confidence bucket, expected calibration error, human-disagreement and false-automation rates, latency/cost — so thresholds come from data. |
| `engine.ts` | `DecisionEngine` façade: run → route → record. It **never executes**. |

## Adopt the architecture, not the vendor

TypeSafe's Jev, an LLM judge, and a rules engine all implement one
`DecisionProvider`. Swap or cascade them without touching callers.

## Shadow first

```ts
const engine = new DecisionEngine({
  provider: new RulesProvider({ /* … */ }),      // or TypeSafeJevProvider once configured
  onRecord: (r) => ledger.append(r),
});
const { route, record } = await engine.decide(state, question, {
  risk: 'R2',
  mode: 'shadow',                                 // logs the decision, acts on nothing
});
// …later: evaluateShadow(ledger.all()) to earn thresholds before going live.
```

## Test

```
pnpm --filter @aion/decision-engine test      # node:test, no network
```
