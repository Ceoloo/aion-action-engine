/**
 * Context Pack Builder — hydrates the right records before an AION agent/tool runs.
 *
 * buildContext({ actor, task, entityType, entityId }) → ContextPack
 */
import type {
  AionTool,
  EntityType,
  EventDefinition,
  ExecutionContext,
  Permission,
} from "@aion/action-core";

export interface BuildContextInput {
  actor: string;
  task: string;
  entityType: EntityType;
  entityId: string;
  actionId?: string;
  sources?: ContextSource[];
}

export type ContextSource =
  | "supabase"
  | "ghl"
  | "notion"
  | "crm"
  | "revenue_copilot"
  | "client_records"
  | "agent_memory"
  | "email"
  | "calendar";

export interface ContextPack {
  id: string;
  actor: string;
  task: string;
  entity_type: EntityType;
  entity_id: string;
  action_id?: string | null;
  identity: Record<string, unknown>;
  business: Record<string, unknown>;
  relationship: Record<string, unknown>;
  recent_activity: Array<Record<string, unknown>>;
  open_commitments: Array<Record<string, unknown>>;
  relevant_documents: Array<Record<string, unknown>>;
  applicable_playbooks: Array<Record<string, unknown>>;
  permissions: string[];
  constraints: string[];
  recommended_context_window: {
    maxTokens: number;
    includeSections: string[];
  };
  sources_used: ContextSource[];
  created_at: string;
}

export const buildContextInputSchema = {
  type: "object",
  required: ["actor", "task", "entityType", "entityId"],
  properties: {
    actor: { type: "string" },
    task: { type: "string" },
    entityType: { type: "string" },
    entityId: { type: "string" },
    actionId: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
} as const;

export const contextPackOutputSchema = {
  type: "object",
  required: ["id", "entity_type", "entity_id", "identity"],
  properties: {
    id: { type: "string" },
    entity_type: { type: "string" },
    entity_id: { type: "string" },
    identity: { type: "object" },
  },
} as const;

export const contextEventDefinitions: EventDefinition[] = [
  {
    name: "context.built",
    description: "A context pack was assembled for an actor/task/entity",
    schema: { type: "object", properties: { contextPackId: { type: "string" } } },
  },
];

let packSeq = 0;

export function createContextPackId(): string {
  packSeq += 1;
  return `ctx_${Date.now().toString(36)}_${packSeq.toString().padStart(3, "0")}`;
}

/** V0 assembler — stubbed connectors with deterministic demo records. */
export function assembleContextPack(input: BuildContextInput): ContextPack {
  const sources = input.sources ?? [
    "supabase",
    "crm",
    "revenue_copilot",
    "client_records",
    "agent_memory",
  ];

  const now = new Date().toISOString();
  const entityLabel = `${input.entityType}:${input.entityId}`;

  return {
    id: createContextPackId(),
    actor: input.actor,
    task: input.task,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action_id: input.actionId ?? null,
    identity: {
      entityType: input.entityType,
      entityId: input.entityId,
      displayName:
        input.entityId === "lead_302" || input.entityId === "lead_302"
          ? "James B"
          : input.entityId.includes("amala")
            ? "Amala"
            : entityLabel,
      stage: input.entityType === "lead" ? "application" : "active",
    },
    business: {
      vertical: "equipment_finance",
      estimatedRevenue: input.entityType === "lead" ? 48000 : null,
      stack: ["GHL", "Supabase", "Revenue Copilot"],
    },
    relationship: {
      owner: "revenue_copilot",
      lastTouchAt: now,
      sentiment: "warm",
      openDeals: input.entityType === "lead" ? 1 : 0,
    },
    recent_activity: [
      { at: now, source: "revenue_copilot", summary: `Task requested: ${input.task}` },
      { at: now, source: "crm", summary: `Loaded ${entityLabel} profile` },
    ],
    open_commitments: [
      {
        type: "follow_up",
        description: "Awaiting remaining bank statements",
        dueInHours: 24,
      },
    ],
    relevant_documents: [
      { id: "doc_app_partial", title: "Partial application packet", source: "supabase" },
    ],
    applicable_playbooks: [
      {
        id: "pb_incomplete_app",
        title: "Incomplete application follow-up",
        source: "revenue_copilot",
      },
    ],
    permissions: ["crm:read", "comms:draft", "actions:execute"],
    constraints: [
      "Do not send without approval when requires_approval=true",
      "Prefer SMS for stalled applications under 72h",
      "Never invent financial figures not present in context",
    ],
    recommended_context_window: {
      maxTokens: 3500,
      includeSections: [
        "identity",
        "relationship",
        "recent_activity",
        "open_commitments",
        "applicable_playbooks",
        "constraints",
      ],
    },
    sources_used: sources,
    created_at: now,
  };
}

export function validateBuildContextInput(input: unknown): input is BuildContextInput {
  if (!input || typeof input !== "object") return false;
  const v = input as Record<string, unknown>;
  return (
    typeof v.actor === "string" &&
    typeof v.task === "string" &&
    typeof v.entityType === "string" &&
    typeof v.entityId === "string"
  );
}

export class ContextPackBuilder implements AionTool<BuildContextInput, ContextPack> {
  readonly name = "aion.context_pack_builder";
  readonly version = "0.1.0";
  readonly permissions: Permission[] = ["context:build", "context:read"];
  readonly events = contextEventDefinitions;
  readonly inputSchema = buildContextInputSchema;
  readonly outputSchema = contextPackOutputSchema;

  private packs = new Map<string, ContextPack>();

  validate(input: BuildContextInput): boolean {
    return validateBuildContextInput(input);
  }

  async execute(input: BuildContextInput, _ctx: ExecutionContext): Promise<ContextPack> {
    return this.build(input);
  }

  build(input: BuildContextInput): ContextPack {
    if (!this.validate(input)) {
      throw new Error("Invalid buildContext input");
    }
    const pack = assembleContextPack(input);
    this.packs.set(pack.id, pack);
    return pack;
  }

  get(id: string): ContextPack | null {
    return this.packs.get(id) ?? null;
  }

  hydrate(packs: ContextPack[]): void {
    for (const pack of packs) {
      this.packs.set(pack.id, pack);
    }
  }

  list(): ContextPack[] {
    return [...this.packs.values()];
  }
}
