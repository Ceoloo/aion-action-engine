/**
 * Producer connectors — Revenue Copilot first, then other AION producers.
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

export type RevenueCopilotEventType =
  | "application_stalled"
  | "proposal_viewed"
  | "rate_inquiry"
  | "urgent_need_detected"
  | "no_activity"
  | "payment_approaching"
  | "high_engagement_no_cta";

export interface RevenueCopilotEvent {
  eventType: RevenueCopilotEventType;
  leadId: string;
  leadName?: string;
  hoursStale?: number;
  confidence?: number;
  details?: string[];
  draftMessage?: string;
  revenueImpact?: number;
}

const EVENT_DEFAULTS: Record<
  RevenueCopilotEventType,
  {
    actionType: CreateActionInput["action_type"];
    channel: NonNullable<CreateActionInput["suggested_action"]>["channel"];
    title: (name: string) => string;
  }
> = {
  application_stalled: {
    actionType: "follow_up",
    channel: "sms",
    title: (name) => `Follow up with ${name} about incomplete application`,
  },
  proposal_viewed: {
    actionType: "call",
    channel: "call",
    title: (name) => `Call ${name} — proposal viewed repeatedly`,
  },
  rate_inquiry: {
    actionType: "follow_up",
    channel: "sms",
    title: (name) => `Educate ${name} on rates`,
  },
  urgent_need_detected: {
    actionType: "call",
    channel: "call",
    title: (name) => `Call ${name} immediately — urgent need`,
  },
  no_activity: {
    actionType: "re_engage",
    channel: "email",
    title: (name) => `Re-engage ${name} — no activity`,
  },
  payment_approaching: {
    actionType: "follow_up",
    channel: "email",
    title: (name) => `Send ROI / renewal summary to ${name}`,
  },
  high_engagement_no_cta: {
    actionType: "call",
    channel: "call",
    title: (name) => `Sales opportunity — ${name} engaged without CTA`,
  },
};

export function revenueCopilotEventToAction(event: RevenueCopilotEvent): CreateActionInput {
  const defaults = EVENT_DEFAULTS[event.eventType];
  const name = event.leadName ?? event.leadId;
  const confidence = event.confidence ?? 0.8;
  const priority = scoreAction({
    urgency:
      confidence >= 0.85 || event.eventType === "urgent_need_detected" ? "high" : "medium",
    actionType: defaults.actionType,
    hoursStale: event.hoursStale,
    buyingIntent: confidence,
    revenueImpact: event.revenueImpact,
    sourceWeight: 3,
  });

  return {
    source: "revenue_copilot",
    entity_type: "lead",
    entity_id: event.leadId,
    action_type: defaults.actionType,
    title: defaults.title(name),
    reason: (event.details ?? [event.eventType]).join("; "),
    priority,
    urgency: priority >= 85 ? "high" : "medium",
    requires_approval: true,
    suggested_action: {
      channel: defaults.channel,
      message: event.draftMessage,
      payload: { eventType: event.eventType, confidence },
    },
    tags: ["revenue", "revenue_copilot", event.eventType],
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
