import type { CreateActionInput } from "./index.js";

export function validateCreateActionInput(input: unknown): input is CreateActionInput {
  if (!input || typeof input !== "object") return false;
  const v = input as Record<string, unknown>;
  return (
    typeof v.source === "string" &&
    v.source.length > 0 &&
    typeof v.entity_type === "string" &&
    typeof v.entity_id === "string" &&
    typeof v.action_type === "string" &&
    typeof v.title === "string" &&
    v.title.trim().length > 0 &&
    typeof v.reason === "string" &&
    v.reason.trim().length > 0
  );
}

export const createActionInputSchema = {
  type: "object",
  required: ["source", "entity_type", "entity_id", "action_type", "title", "reason"],
  properties: {
    source: { type: "string" },
    entity_type: { type: "string" },
    entity_id: { type: "string" },
    action_type: { type: "string" },
    title: { type: "string" },
    reason: { type: "string" },
    priority: { type: "number", minimum: 0, maximum: 100 },
    urgency: { type: "string", enum: ["critical", "high", "medium", "low"] },
    requires_approval: { type: "boolean" },
    suggested_action: {
      type: "object",
      properties: {
        channel: { type: "string" },
        message: { type: "string" },
        tool: { type: "string" },
        payload: { type: "object" },
      },
    },
    due_at: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    context_pack_id: { type: ["string", "null"] },
  },
} as const;

export const actionOutputSchema = {
  type: "object",
  required: ["id", "source", "status", "priority", "title"],
  properties: {
    id: { type: "string" },
    source: { type: "string" },
    status: { type: "string" },
    priority: { type: "number" },
    title: { type: "string" },
  },
} as const;
