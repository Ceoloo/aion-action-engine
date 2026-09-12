/**
 * Producer connectors — thin adapters that emit CreateActionInput payloads.
 * V0 ships stubs that map known AION producers into the Action Queue.
 */
import type { CreateActionInput } from "@aion/actions";
import { scoreAction } from "@aion/scoring";

export interface RevenueSignal {
  entityId: string;
  signal: string;
  confidence: number;
  reasons: string[];
  recommendedAction: "call_now" | "follow_up" | "re_engage" | "educate";
  hoursStale?: number;
}

export function revenueSignalToAction(signal: RevenueSignal): CreateActionInput {
  const actionType =
    signal.recommendedAction === "call_now"
      ? "call"
      : signal.recommendedAction === "re_engage"
        ? "re_engage"
        : "follow_up";

  const priority = scoreAction({
    urgency: signal.confidence >= 0.85 ? "high" : "medium",
    actionType,
    hoursStale: signal.hoursStale,
    buyingIntent: signal.confidence,
    sourceWeight: 2,
  });

  const titles: Record<RevenueSignal["recommendedAction"], string> = {
    call_now: `Call now — ${signal.signal}`,
    follow_up: `Follow up — ${signal.signal}`,
    re_engage: `Re-engage — ${signal.signal}`,
    educate: `Educate — ${signal.signal}`,
  };

  return {
    source: "revenue_signal_engine",
    entity_type: "lead",
    entity_id: signal.entityId,
    action_type: actionType,
    title: titles[signal.recommendedAction],
    reason: signal.reasons.join("; "),
    priority,
    urgency: priority >= 85 ? "high" : "medium",
    requires_approval: true,
    suggested_action: {
      channel: signal.recommendedAction === "call_now" ? "call" : "sms",
      payload: { signal: signal.signal, confidence: signal.confidence },
    },
    tags: ["revenue", signal.signal],
  };
}

export interface AgentRecommendation {
  source: string;
  entityType: CreateActionInput["entity_type"];
  entityId: string;
  title: string;
  reason: string;
  actionType: CreateActionInput["action_type"];
  autoExecutable?: boolean;
}

export function agentRecommendationToAction(rec: AgentRecommendation): CreateActionInput {
  return {
    source: rec.source,
    entity_type: rec.entityType,
    entity_id: rec.entityId,
    action_type: rec.actionType,
    title: rec.title,
    reason: rec.reason,
    priority: scoreAction({
      actionType: rec.actionType,
      urgency: rec.autoExecutable ? "medium" : "high",
    }),
    requires_approval: !rec.autoExecutable,
    suggested_action: {
      channel: rec.autoExecutable ? "agent" : "internal",
      tool: rec.source,
    },
    tags: rec.autoExecutable ? ["automated"] : [],
  };
}

export const CONNECTOR_SOURCES = [
  "revenue_copilot",
  "revenue_signal_engine",
  "client_os",
  "agent_os",
  "meeting_notes",
  "operator_console",
  "manual",
] as const;
