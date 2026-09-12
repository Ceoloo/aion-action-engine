import { createExecutionContext } from "@aion/core";
import { permissionsForRole } from "@aion/permissions";
import { revenueSignalToAction, agentRecommendationToAction } from "@aion/connectors";
import { migrate, openDb, getDbPath } from "./client.js";
import { ActionRepository } from "./repository.js";
import { ActionEngine } from "../engine.js";

const db = openDb();
migrate(db);

// Reset for deterministic seed
db.exec("DELETE FROM action_events");
db.exec("DELETE FROM actions");

const engine = new ActionEngine(new ActionRepository(db));
const ctx = createExecutionContext({
  actor: "seed",
  actorType: "system",
  permissions: permissionsForRole("admin"),
});

const endOfToday = new Date();
endOfToday.setHours(18, 0, 0, 0);

const seeds = [
  {
    source: "revenue_copilot",
    entity_type: "lead" as const,
    entity_id: "lead_302",
    action_type: "follow_up" as const,
    title: "Follow up with James about bank statements",
    reason: "Application incomplete for 48 hours",
    priority: 91,
    urgency: "high" as const,
    suggested_action: {
      channel: "sms" as const,
      message:
        "Hi James — quick nudge on the remaining bank statements so we can finish underwriting today.",
    },
    requires_approval: true,
    tags: ["revenue"],
    due_at: new Date().toISOString(),
  },
  {
    source: "agent_os",
    entity_type: "deploy" as const,
    entity_id: "deploy_rc_prod",
    action_type: "review" as const,
    title: "Review Revenue Copilot production deployment",
    reason: "Production deployment available; engineering blocker until approved",
    priority: 83,
    urgency: "high" as const,
    suggested_action: { channel: "internal" as const, tool: "deploy.inspect" },
    requires_approval: true,
    tags: ["engineering"],
    due_at: endOfToday.toISOString(),
  },
  {
    source: "client_os",
    entity_type: "client" as const,
    entity_id: "client_amala",
    action_type: "onboard" as const,
    title: "Prepare Amala onboarding packet",
    reason: "Kickoff scheduled; Client OS needs packet generated",
    priority: 71,
    urgency: "medium" as const,
    suggested_action: { channel: "agent" as const, tool: "client.onboarding.generate" },
    requires_approval: false,
    tags: ["client"],
    due_at: endOfToday.toISOString(),
  },
  {
    source: "media_os",
    entity_type: "content" as const,
    entity_id: "content_042",
    action_type: "approve" as const,
    title: "Approve content draft for LinkedIn",
    reason: "Draft ready; waiting on operator review",
    priority: 68,
    urgency: "medium" as const,
    suggested_action: { channel: "web" as const },
    requires_approval: true,
    tags: ["media"],
    due_at: endOfToday.toISOString(),
  },
  {
    source: "company_os",
    entity_type: "decision" as const,
    entity_id: "dec_supabase",
    action_type: "decision" as const,
    title: "Confirm Supabase as canonical operational database",
    reason: "CEO decision required before Agent OS context packs ship",
    priority: 88,
    urgency: "critical" as const,
    suggested_action: { channel: "internal" as const },
    requires_approval: true,
    tags: ["needs_you", "holding"],
  },
  revenueSignalToAction({
    entityId: "lead_102",
    signal: "high_buying_intent",
    confidence: 0.91,
    reasons: ["proposal_viewed_3x", "recent_reply", "urgent_cash_need"],
    recommendedAction: "call_now",
  }),
  agentRecommendationToAction({
    source: "agent_os",
    entityType: "lead",
    entityId: "lead_220",
    title: "Auto-send education sequence on rates",
    reason: "Prospect asked about rates; sequence can run without human",
    actionType: "send",
    autoExecutable: true,
  }),
];

for (const seed of seeds) {
  await engine.createAction(seed, ctx);
}

// Mark auto-exec ones as automated for the AUTOMATED bucket demo
const autoList = engine.listActions().filter((a) => a.tags?.includes("automated"));
for (const a of autoList) {
  const { action: executing } = await engine.executeAction(a.id, ctx);
  const repo = new ActionRepository(db);
  repo.upsert({ ...executing, status: "automated", updated_at: new Date().toISOString() });
}

console.log(`Seeded ${engine.listActions().length} actions into ${getDbPath()}`);
db.close();
