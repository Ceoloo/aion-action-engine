import type { ActionObject, ActionOutcome, ExecutionContext, Permission } from "@aion/core";
import {
  approveAction,
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
import type { AionTool } from "@aion/core";
import type { ActionRepository } from "./db/repository.js";

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
  ];
  readonly events = actionEventDefinitions;
  readonly inputSchema = createActionInputSchema;
  readonly outputSchema = actionOutputSchema;

  constructor(
    private readonly repo: ActionRepository,
    private readonly bus = new ActionEventEmitter()
  ) {
    this.bus.on("*", async (event) => {
      this.repo.insertEvent(event);
    });
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
    const next = approveAction(current, approvedBy, approve);
    return this.persistTransition(next, ctx.actor);
  }

  async executeAction(actionId: string, ctx: ExecutionContext): Promise<ActionObject> {
    assertPermission(ctx, "actions:execute");
    const current = this.require(actionId);
    const next = executeAction(current);
    return this.persistTransition(next, ctx.actor);
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
