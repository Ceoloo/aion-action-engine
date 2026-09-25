import type { ActionObject, ActionOutcome, ExecutionContext, Permission } from "@aion/core";
import {
  approveAction,
  attachContextPack,
  claimAction,
  completeAction,
  executeAction,
  groupByBucket,
  normalizeCreateInput,
  recordOutcome,
  validateCreateActionInput,
  type CreateActionInput,
  createActionInputSchema,
  actionOutputSchema,
} from "@aion/actions";
import { ActionEventEmitter, actionEventDefinitions, statusToEventName } from "@aion/events";
import { assertPermission } from "@aion/permissions";
import { ContextPackBuilder, type ContextPack } from "@aion/context";
import type { AionTool } from "@aion/core";
import type { DecisionRecord, ShadowReport } from "@aion/decision-engine";
import type { ActionRepository } from "./db/repository.js";
import { ShadowDecisionRecorder } from "./decision/shadow.js";

export class ActionEngine implements AionTool<CreateActionInput, ActionObject> {
  readonly name = "aion.action_queue";
  readonly version = "0.1.0";
  readonly permissions: Permission[] = [
    "actions:create",
    "actions:read",
    "actions:claim",
    "actions:approve",
    "actions:execute",
    "actions:complete",
    "actions:outcome",
    "context:build",
    "context:read",
  ];
  readonly events = actionEventDefinitions;
  readonly inputSchema = createActionInputSchema;
  readonly outputSchema = actionOutputSchema;

  readonly contextBuilder: ContextPackBuilder;
  /**
   * Optional shadow-mode Decision Plane (ADR-010 Phase 2). When present it
   * observes the approval gate and records what auto-approve *would* have
   * decided, with the human decision as ground truth. It never gates or
   * executes — a null recorder leaves behaviour unchanged.
   */
  private readonly recorder?: ShadowDecisionRecorder;

  constructor(
    private readonly repo: ActionRepository,
    private readonly bus = new ActionEventEmitter(),
    contextBuilder?: ContextPackBuilder,
    recorder?: ShadowDecisionRecorder
  ) {
    this.contextBuilder = contextBuilder ?? new ContextPackBuilder();
    this.recorder = recorder;
    this.bus.on("*", async (event) => {
      this.repo.insertEvent(event);
    });
    this.contextBuilder.hydrate(this.repo.listContextPacks());
  }

  validate(input: CreateActionInput): boolean {
    return validateCreateActionInput(input);
  }

  async execute(input: CreateActionInput, context: ExecutionContext): Promise<ActionObject> {
    return this.createAction(input, context);
  }

  async createAction(input: CreateActionInput, ctx: ExecutionContext): Promise<ActionObject> {
    assertPermission(ctx, "actions:create");
    if (!this.validate(input)) {
      throw new Error("Invalid createAction input");
    }
    const action = normalizeCreateInput(input);
    this.repo.upsert(action);
    await this.bus.emit("action.created", action, ctx.actor, { source: action.source });
    return action;
  }

  listActions(): ActionObject[] {
    return this.repo.list();
  }

  getAction(id: string): ActionObject | null {
    return this.repo.getById(id);
  }

  buckets(now = new Date()) {
    return groupByBucket(this.repo.list(), now);
  }

  async claim(actionId: string, claimedBy: string, ctx: ExecutionContext): Promise<ActionObject> {
    assertPermission(ctx, "actions:claim");
    const current = this.require(actionId);
    const next = claimAction(current, claimedBy);
    return this.persistTransition(next, ctx.actor);
  }

  async approve(
    actionId: string,
    approvedBy: string,
    approve: boolean,
    ctx: ExecutionContext
  ): Promise<ActionObject> {
    assertPermission(ctx, "actions:approve");
    const current = this.require(actionId);
    // Apply and persist the human decision FIRST; only then shadow it. If the
    // transition is invalid or persistence throws we never record a phantom
    // decision. `current` is the captured pre-approval state, so the shadow
    // still predicts the human on the state they decided from. The shadow path
    // is fully decoupled and never changes the action's outcome.
    const next = approveAction(current, approvedBy, approve);
    const persisted = await this.persistTransition(next, ctx.actor);
    await this.recorder?.observe(current);
    this.recorder?.settle(actionId, approve, approvedBy);
    return persisted;
  }

  // ── Decision Plane (shadow) read surface ─────────────────────────────────
  // Empty/absent when no recorder is wired, so callers need no null-checks.

  /** Shadow decision records captured at the approval gate. */
  shadowRecords(): DecisionRecord[] {
    return this.recorder?.records() ?? [];
  }

  /** Calibration report over shadow records with known ground truth. */
  shadowReport(): ShadowReport | null {
    return this.recorder?.report() ?? null;
  }

  /** Shadow calibration report segmented by experiment variant. */
  shadowReportByVariant(): Record<string, ShadowReport> {
    return this.recorder?.reportByVariant() ?? {};
  }

  async executeAction(
    actionId: string,
    ctx: ExecutionContext
  ): Promise<{ action: ActionObject; contextPack: ContextPack }> {
    assertPermission(ctx, "actions:execute");
    const current = this.require(actionId);

    const contextPack = this.buildContextForAction(current, ctx);
    this.repo.upsertContextPack(contextPack);

    let next = attachContextPack(current, contextPack.id);
    next = executeAction(next);
    await this.persistTransition(next, ctx.actor);
    await this.bus.emit("context.built", next, ctx.actor, {
      contextPackId: contextPack.id,
      sections: contextPack.recommended_context_window.includeSections,
    });

    return { action: next, contextPack };
  }

  async complete(
    actionId: string,
    status: "completed" | "failed" | "cancelled",
    ctx: ExecutionContext
  ): Promise<ActionObject> {
    assertPermission(ctx, "actions:complete");
    const current = this.require(actionId);
    const next = completeAction(current, status);
    return this.persistTransition(next, ctx.actor);
  }

  async recordOutcome(
    actionId: string,
    outcome: ActionOutcome,
    ctx: ExecutionContext
  ): Promise<ActionObject> {
    assertPermission(ctx, "actions:outcome");
    const current = this.require(actionId);
    const next = recordOutcome(current, outcome);
    this.repo.upsert(next);
    await this.bus.emit("action.outcome_recorded", next, ctx.actor, { outcome });
    return next;
  }

  buildContextForAction(action: ActionObject, ctx: ExecutionContext): ContextPack {
    assertPermission(ctx, "context:build");
    return this.contextBuilder.build({
      actor: ctx.actor,
      task: action.action_type,
      entityType: action.entity_type,
      entityId: action.entity_id,
      actionId: action.id,
    });
  }

  async buildContext(
    input: {
      actor: string;
      task: string;
      entityType: ActionObject["entity_type"];
      entityId: string;
      actionId?: string;
    },
    ctx: ExecutionContext
  ): Promise<ContextPack> {
    assertPermission(ctx, "context:build");
    const pack = this.contextBuilder.build(input);
    this.repo.upsertContextPack(pack);
    return pack;
  }

  getContextPack(id: string): ContextPack | null {
    return this.contextBuilder.get(id) ?? this.repo.getContextPack(id);
  }

  getEvents(actionId?: string) {
    return this.repo.listEvents(actionId);
  }

  private require(id: string): ActionObject {
    const action = this.repo.getById(id);
    if (!action) throw new Error(`Action not found: ${id}`);
    return action;
  }

  private async persistTransition(action: ActionObject, actor: string): Promise<ActionObject> {
    this.repo.upsert(action);
    const eventName = statusToEventName(action.status);
    if (eventName) {
      await this.bus.emit(eventName, action, actor);
    }
    return action;
  }
}
