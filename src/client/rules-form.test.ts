import { describe, expect, it } from "vitest";

import type { RuleDto } from "../shared/types.js";
import { draftToRule, goesLive, moveRule, newRuleDraft, ruleToDraft, validateDrafts, type RuleDraft } from "./rules-form.js";

const rule = (overrides: Partial<RuleDto> = {}): RuleDto => ({
  id: "news", account: "andre", enabled: true, dryRun: true,
  condition: { field: "from", match: "contains", value: "news@x.test" },
  actions: [{ type: "flag", flag: "seen", value: true }],
  ...overrides,
});
const draft = (overrides: Partial<RuleDraft> = {}): RuleDraft => ({ ...ruleToDraft(rule()), ...overrides });

describe("newRuleDraft", () => {
  it("starts enabled and in dry-run with the first free name", () => {
    expect(newRuleDraft("andre", [])).toMatchObject({ id: "Regel 1", account: "andre", enabled: true, dryRun: true, field: "from", match: "contains", value: "" });
    expect(newRuleDraft("andre", ["Regel 1", "regel 2"]).id).toBe("Regel 3");
  });

  it("has no action chosen yet", () => {
    expect(newRuleDraft("andre", [])).toMatchObject({ markSeen: false, markFlagged: false, moveTo: "", extraActions: [] });
  });
});

describe("ruleToDraft / draftToRule", () => {
  it("round-trips the editable actions", () => {
    const original = rule({ actions: [{ type: "flag", flag: "seen", value: true }, { type: "flag", flag: "flagged", value: true }, { type: "move", mailbox: "Newsletter" }] });

    expect(ruleToDraft(original)).toMatchObject({ markSeen: true, markFlagged: true, moveTo: "Newsletter", extraActions: [] });
    expect(draftToRule(ruleToDraft(original)).actions).toEqual(original.actions);
  });

  it("keeps actions it has no control for, unchanged", () => {
    const original = rule({ actions: [
      { type: "flag", flag: "answered", value: true }, { type: "flag", flag: "seen", value: false },
      { type: "move", mailbox: "A" }, { type: "move", mailbox: "B" },
    ] });
    const back = draftToRule(ruleToDraft(original));

    expect(ruleToDraft(original).extraActions).toHaveLength(3);
    expect(back.actions).toEqual(expect.arrayContaining(original.actions));
    expect(back.actions).toHaveLength(4);
  });

  it("trims name and value", () => {
    const result = draftToRule(draft({ id: "  Name  ", value: "  x  " }));

    expect(result.id).toBe("Name");
    expect(result.condition.value).toBe("x");
  });
});

describe("validateDrafts", () => {
  it("accepts a complete rule", () => {
    expect(validateDrafts([draft()])).toEqual([]);
  });

  it("reports each problem in German with the rule's name", () => {
    expect(validateDrafts([draft({ id: "  " })])).toContain("Eine Regel hat keinen Namen.");
    expect(validateDrafts([draft({ id: "x".repeat(65) })])[0]).toContain("höchstens 64 Zeichen");
    expect(validateDrafts([draft({ value: "  " })])).toContain("Regel „news“: Bitte einen Suchtext eingeben.");
    expect(validateDrafts([draft({ value: "x".repeat(201) })])).toContain("Regel „news“: Der Suchtext darf höchstens 200 Zeichen haben.");
    expect(validateDrafts([draft({ markSeen: false })])).toContain("Regel „news“: Bitte mindestens eine Aktion wählen.");
  });

  it("detects duplicate names ignoring case and spaces, once per name", () => {
    const problems = validateDrafts([draft({ id: "A" }), draft({ id: " a " }), draft({ id: "a" })]);

    expect(problems.filter((message) => message.includes("mehrfach"))).toEqual(["Der Name „A“ kommt mehrfach vor."]);
  });

  it("limits the number of rules and of actions", () => {
    const many = Array.from({ length: 101 }, (_, index) => draft({ id: `r${index}` }));
    const manyActions = draft({ extraActions: Array.from({ length: 8 }, () => ({ type: "flag" as const, flag: "answered" as const, value: true })) });

    expect(validateDrafts(many)).toContain("Es können höchstens 100 Regeln gespeichert werden.");
    expect(validateDrafts([manyActions])).toContain("Regel „news“: Höchstens 8 Aktionen.");
  });
});

describe("goesLive", () => {
  const live = (id: string, overrides: Partial<RuleDto> = {}) => rule({ id, dryRun: false, ...overrides });

  it("lists new live rules, rules leaving dry-run and newly enabled live rules", () => {
    const before = [rule({ id: "dry" }), live("off", { enabled: false }), live("same")];
    const after = [live("dry"), live("off"), live("same"), live("fresh")];

    expect(goesLive(before, after)).toEqual(["dry", "off", "fresh"]);
  });

  it("ignores dry-run, disabled and unchanged live rules", () => {
    const before = [live("same")];
    const after = [live("same"), rule({ id: "dry" }), live("disabled", { enabled: false })];

    expect(goesLive(before, after)).toEqual([]);
  });
});

describe("moveRule", () => {
  const ids = (list: RuleDraft[]) => list.map((item) => item.id);
  const list = [draft({ id: "a" }), draft({ id: "b" }), draft({ id: "c" })];

  it("swaps with the neighbour", () => {
    expect(ids(moveRule(list, 1, -1))).toEqual(["b", "a", "c"]);
    expect(ids(moveRule(list, 1, 1))).toEqual(["a", "c", "b"]);
  });

  it("does nothing at the boundaries", () => {
    expect(ids(moveRule(list, 0, -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveRule(list, 2, 1))).toEqual(["a", "b", "c"]);
  });
});
