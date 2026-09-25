import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StaticExperimentProvider,
  HashExperimentProvider,
  hashUnitInterval,
  DecisionEngine,
  RulesProvider,
  evaluateShadowByVariant,
  type DecisionRecord,
  type ChoiceQuestion,
  type DecisionState,
} from "../index.js";

describe("StaticExperimentProvider", () => {
  it("returns explicit assignments, then defaults, then undefined", () => {
    const p = new StaticExperimentProvider({
      assignments: { thresholds: { "tenant-a": "aggressive" } },
      defaults: { thresholds: "control" },
    });
    assert.equal(p.variant("thresholds", { unit: "tenant-a" }), "aggressive");
    assert.equal(p.variant("thresholds", { unit: "tenant-z" }), "control");
    assert.equal(p.variant("other", { unit: "tenant-a" }), undefined);
  });

  it("does not resolve reserved keys/units to inherited object members", () => {
    const p = new StaticExperimentProvider({
      assignments: { thresholds: { "tenant-a": "aggressive" } },
      defaults: { thresholds: "control" },
    });
    // Neither a reserved experiment key nor a reserved unit may leak a function.
    assert.equal(p.variant("constructor", { unit: "tenant-a" }), undefined);
    assert.equal(p.variant("thresholds", { unit: "toString" }), "control");
  });
});

describe("HashExperimentProvider", () => {
  const provider = new HashExperimentProvider({
    experiments: {
      thresholds: [
        { name: "control", weight: 50 },
        { name: "aggressive", weight: 50 },
      ],
    },
  });

  it("is sticky: same unit always gets the same variant", () => {
    const a = provider.variant("thresholds", { unit: "tenant-42" });
    const b = provider.variant("thresholds", { unit: "tenant-42" });
    assert.equal(a, b);
    assert.ok(a === "control" || a === "aggressive");
  });

  it("splits roughly by weight across many units", () => {
    let aggressive = 0;
    const n = 4000;
    for (let i = 0; i < n; i += 1) {
      if (provider.variant("thresholds", { unit: `u${i}` }) === "aggressive") {
        aggressive += 1;
      }
    }
    const share = aggressive / n;
    assert.ok(share > 0.4 && share < 0.6, `share ${share} not ~0.5`);
  });

  it("returns undefined for an unconfigured experiment", () => {
    assert.equal(provider.variant("missing", { unit: "x" }), undefined);
  });

  it("treats reserved experiment keys as unconfigured, not inherited members", () => {
    assert.equal(provider.variant("constructor", { unit: "x" }), undefined);
    assert.equal(provider.variant("__proto__", { unit: "x" }), undefined);
    assert.equal(provider.variant("toString", { unit: "x" }), undefined);
  });

  it("rejects an experiment with a non-finite weight instead of collapsing", () => {
    const bad = new HashExperimentProvider({
      experiments: {
        thresholds: [
          { name: "control", weight: 50 },
          { name: "aggressive", weight: Number.NaN },
        ],
      },
    });
    assert.equal(bad.variant("thresholds", { unit: "u1" }), undefined);
  });

  it("hashUnitInterval is deterministic and in [0,1)", () => {
    const v = hashUnitInterval("thresholds:tenant-42");
    assert.equal(v, hashUnitInterval("thresholds:tenant-42"));
    assert.ok(v >= 0 && v < 1);
  });
});

const nextAction: ChoiceQuestion = {
  id: "next_action",
  kind: "choice",
  prompt: "Next action?",
  choices: ["request_documents", "follow_up"],
};

function engineFor(variantForTenant: Record<string, string>) {
  return new DecisionEngine({
    provider: new RulesProvider({
      choice: { next_action: () => "request_documents" },
      defaultConfidence: 0.92, // between low-risk band (0.90) and auto (0.97)
    }),
    experiment: {
      provider: new StaticExperimentProvider({ assignments: { thresholds: variantForTenant } }),
      key: "thresholds",
      variants: {
        // Aggressive lowers the auto-execute bar so 0.92 auto-executes.
        aggressive: { autoExecute: 0.9 },
        control: {},
      },
    },
  });
}

describe("DecisionEngine experiments", () => {
  it("routes differently per variant and tags the record", async () => {
    const engine = engineFor({ "tenant-agg": "aggressive", "tenant-ctrl": "control" });
    const state: DecisionState = { features: {}, tenantId: "tenant-agg" };

    const agg = await engine.decide(state, nextAction, { risk: "R1" });
    assert.equal(agg.route.route, "auto_execute");
    assert.equal(agg.record.experimentKey, "thresholds");
    assert.equal(agg.record.variant, "aggressive");

    const ctrl = await engine.decide(
      { features: {}, tenantId: "tenant-ctrl" },
      nextAction,
      { risk: "R1" },
    );
    // Control keeps the default 0.97 bar → 0.92 lands on the low-risk path.
    assert.equal(ctrl.route.route, "auto_execute_low_risk");
    assert.equal(ctrl.record.variant, "control");
  });

  it("high risk still routes to a human regardless of variant", async () => {
    const engine = engineFor({ "tenant-agg": "aggressive" });
    const outcome = await engine.decide(
      { features: {}, tenantId: "tenant-agg" },
      nextAction,
      { risk: "R3" },
    );
    assert.equal(outcome.route.route, "human_approval");
  });
});

describe("evaluateShadowByVariant", () => {
  it("segments a report per variant", () => {
    let seq = 0;
    const rec = (variant: string, selected: boolean, truth: boolean): DecisionRecord => {
      seq += 1;
      return {
        decisionId: `dec_${seq}`,
        provider: "rules",
        stateHash: "h",
        decisionType: "binary",
        questionId: "q",
        selectedChoice: selected,
        confidence: 0.9,
        route: "llm_verify",
        createdAt: new Date().toISOString(),
        experimentKey: "thresholds",
        variant,
        groundTruth: truth,
      };
    };
    const report = evaluateShadowByVariant([
      rec("aggressive", true, true),
      rec("aggressive", true, false),
      rec("control", true, true),
    ]);
    assert.equal(report["thresholds :: aggressive"]!.scored, 2);
    assert.equal(report["thresholds :: aggressive"]!.accuracy, 0.5);
    assert.equal(report["thresholds :: control"]!.accuracy, 1);
  });

  it("does not pool a shared variant name across different experiments", () => {
    const rec = (experimentKey: string, truth: boolean): DecisionRecord => ({
      decisionId: `dec_${experimentKey}_${truth}`,
      provider: "rules",
      stateHash: "h",
      decisionType: "binary",
      questionId: "q",
      selectedChoice: true,
      confidence: 0.9,
      route: "llm_verify",
      createdAt: new Date().toISOString(),
      experimentKey,
      variant: "control",
      groundTruth: truth,
    });
    // Two experiments, both with a "control" arm — must stay separate.
    const report = evaluateShadowByVariant([rec("exp_a", true), rec("exp_b", false)]);
    assert.equal(report["exp_a :: control"]!.accuracy, 1);
    assert.equal(report["exp_b :: control"]!.accuracy, 0);
  });
});
