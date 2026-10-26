import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import type { Rule } from "./rules.js";
import { previewRule, readStoredRules, rulesSchema, writeStoredRules } from "./rules-store.js";

let dir = "";
let path = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "himalaya-web-rules-store-test-"));
  path = join(dir, "rules.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "news", account: "andre", enabled: true, dryRun: true,
  condition: { field: "from", match: "contains", value: "newsletter@x.test" },
  actions: [{ type: "flag", flag: "seen", value: true }],
  ...overrides,
});

describe("readStoredRules", () => {
  it("reads a missing file as no rules, not as a damaged one", async () => {
    expect(await readStoredRules(path)).toEqual({ rules: [], preservedInvalid: 0, unreadable: false });
  });

  it.each(["{not json", JSON.stringify({ a: 1 }), "42", '[{"id": "x"},]'])("reads %j as no rules and flags the file as unreadable", async (content) => {
    await writeFile(path, content);

    expect(await readStoredRules(path)).toEqual({ rules: [], preservedInvalid: 0, unreadable: true });
  });

  it("splits valid rules from entries it cannot edit", async () => {
    await writeFile(path, JSON.stringify([rule(), { ...rule({ id: "bad" }), dryRun: "true" }, "text", rule({ id: "two" })]));

    const stored = await readStoredRules(path);

    expect(stored.rules.map((item) => item.id)).toEqual(["news", "two"]);
    expect(stored.preservedInvalid).toBe(2);
  });

  it("treats a missing enabled/dryRun like the engine does (false)", async () => {
    const { enabled: _e, dryRun: _d, ...bare } = rule();
    await writeFile(path, JSON.stringify([bare]));

    expect((await readStoredRules(path)).rules[0]).toMatchObject({ enabled: false, dryRun: false });
  });

  it("keeps rules with extra keys out of the editable set instead of stripping the keys", async () => {
    await writeFile(path, JSON.stringify([{ ...rule(), comment: "mine" }]));

    expect(await readStoredRules(path)).toEqual({ rules: [], preservedInvalid: 1, unreadable: false });
  });
});

describe("writeStoredRules", () => {
  it("writes the rules and keeps invalid entries verbatim after them", async () => {
    const invalid = [{ ...rule({ id: "bad" }), dryRun: "true" }, "text"];
    await writeFile(path, JSON.stringify([rule({ id: "old" }), ...invalid]));

    await writeStoredRules([rule({ id: "new", dryRun: false })], path);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([rule({ id: "new", dryRun: false }), ...invalid]);
    expect(await readStoredRules(path)).toMatchObject({ preservedInvalid: 2 });
  });

  it("never destroys a hand-edited file it cannot read: a backup copy comes first", async () => {
    const damaged = '[{"id": "mine", "account": "andre",}]';
    await writeFile(path, damaged);

    await writeStoredRules([rule()], path);

    const backups = (await readdir(dir)).filter((name) => name.startsWith("rules.json.unreadable-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(dir, backups[0]!), "utf8")).toBe(damaged);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([rule()]);
  });

  it("makes no backup when the file was readable or missing", async () => {
    await writeStoredRules([rule()], path);
    await writeStoredRules([rule({ id: "two" })], path);

    expect((await readdir(dir)).filter((name) => name.includes("unreadable"))).toEqual([]);
  });

  it("creates a missing file privately and replaces atomically", async () => {
    await writeStoredRules([rule()], path);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["rules.json"]);
  });

  it("keeps the mode of an existing file", async () => {
    await writeFile(path, "[]");
    await chmod(path, 0o640);
    await writeStoredRules([rule()], path);

    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it("leaves a valid file after many parallel writes", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => writeStoredRules([rule({ id: `r${index}` })], path)));

    const stored = await readStoredRules(path);
    expect(stored.rules).toHaveLength(1);
    expect(stored.rules[0]!.id).toMatch(/^r\d$/);
  });
});

describe("rulesSchema", () => {
  const ok = (rules: unknown): boolean => rulesSchema.safeParse(rules).success;

  it("accepts valid rules", () => {
    expect(ok([rule(), rule({ id: "two", actions: [{ type: "move", mailbox: "Newsletter" }] })])).toBe(true);
  });

  it.each([
    ["duplicate ids", [rule(), rule()]],
    ["no actions", [rule({ actions: [] })]],
    ["nine actions", [rule({ actions: Array.from({ length: 9 }, () => ({ type: "flag" as const, flag: "seen" as const, value: true })) })]],
    ["unknown field", [{ ...rule(), condition: { field: "cc", match: "contains", value: "x" } }]],
    ["unknown match", [{ ...rule(), condition: { field: "from", match: "regex", value: "x" } }]],
    ["unknown flag", [rule({ actions: [{ type: "flag", flag: "deleted" as never, value: true }] })]],
    ["empty value", [rule({ condition: { field: "from", match: "contains", value: "" } })]],
    ["201-character value", [rule({ condition: { field: "from", match: "contains", value: "x".repeat(201) } })]],
    ["empty move target", [rule({ actions: [{ type: "move", mailbox: "" }] })]],
    ["empty id", [rule({ id: "" })]],
    ["65-character id", [rule({ id: "x".repeat(65) })]],
    ["101 rules", Array.from({ length: 101 }, (_, index) => rule({ id: `r${index}` }))],
    ["a string enabled", [{ ...rule(), enabled: "yes" }]],
  ])("rejects %s", (_name, rules) => {
    expect(ok(rules)).toBe(false);
  });
});

describe("previewRule", () => {
  const envelope = (subject: string, from: string, name: string | null = null): Envelope => (
    { id: subject, date: null, flags: [], from: [{ name, email: from }], to: [], subject, size: 1, hasAttachment: false }
  );

  it("counts matches case-insensitively and reports what was checked", () => {
    const envelopes = [envelope("A", "Newsletter@X.test"), envelope("B", "other@x.test"), envelope("C", "newsletter@x.test", "News")];

    const preview = previewRule(rule(), envelopes);

    expect(preview).toMatchObject({ checked: 3, matchCount: 2 });
    expect(preview.samples).toEqual([{ subject: "A", from: "Newsletter@X.test" }, { subject: "C", from: "News" }]);
  });

  it("honors equals and caps the samples at 10", () => {
    const many = Array.from({ length: 15 }, (_, index) => envelope(`S${index}`, "newsletter@x.test"));

    expect(previewRule(rule(), many).samples).toHaveLength(10);
    expect(previewRule(rule({ condition: { field: "from", match: "equals", value: "newsletter" } }), many).matchCount).toBe(0);
  });
});
