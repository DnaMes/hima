import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Envelope } from "../shared/types.js";
import { matchesCondition, planActions, readRules, type Rule } from "./rules.js";

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: "1",
    date: null,
    flags: [],
    from: [{ name: "Newsletter Team", email: "newsletter@example.test" }],
    to: [{ name: "Andre", email: "andre@example.test" }],
    subject: "Weekly digest",
    size: 10,
    hasAttachment: false,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    account: "andre",
    enabled: true,
    dryRun: false,
    condition: { field: "from", match: "contains", value: "newsletter@example.test" },
    actions: [{ type: "flag", flag: "seen", value: true }],
    ...overrides,
  };
}

describe("matchesCondition", () => {
  it("matches 'from' by email, case-insensitively, for contains and equals", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "from", match: "contains", value: "NEWSLETTER@example.test" })).toBe(true);
    expect(matchesCondition(env, { field: "from", match: "equals", value: "newsletter@example.test" })).toBe(true);
    expect(matchesCondition(env, { field: "from", match: "equals", value: "other@example.test" })).toBe(false);
  });

  it("matches 'from' by display name too", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "from", match: "contains", value: "newsletter team" })).toBe(true);
  });

  it("matches 'to' the same way as 'from'", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "to", match: "equals", value: "andre@example.test" })).toBe(true);
  });

  it("matches 'subject' as plain text, case-insensitively", () => {
    const env = envelope({ subject: "Weekly Digest" });
    expect(matchesCondition(env, { field: "subject", match: "contains", value: "digest" })).toBe(true);
    expect(matchesCondition(env, { field: "subject", match: "equals", value: "weekly digest" })).toBe(true);
    expect(matchesCondition(env, { field: "subject", match: "equals", value: "digest" })).toBe(false);
  });

  it("returns false when no address in the field matches", () => {
    const env = envelope({ from: [{ name: null, email: "someone-else@example.test" }] });
    expect(matchesCondition(env, { field: "from", match: "contains", value: "newsletter" })).toBe(false);
  });
});

describe("planActions", () => {
  it("returns one outcome per matching rule, and none for a non-matching rule", () => {
    const matching = rule({ id: "match" });
    const nonMatching = rule({ id: "no-match", condition: { field: "from", match: "equals", value: "nobody@example.test" } });
    const outcomes = planActions(envelope(), [matching, nonMatching]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ruleId).toBe("match");
  });

  it("applies every matching rule's flag actions", () => {
    const flagSeen = rule({ id: "seen-rule", actions: [{ type: "flag", flag: "seen", value: true }] });
    const flagFlagged = rule({ id: "flagged-rule", actions: [{ type: "flag", flag: "flagged", value: true }] });
    const outcomes = planActions(envelope(), [flagSeen, flagFlagged]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ ruleId: "seen-rule", flagsApplied: [{ flag: "seen", value: true }], movedTo: null });
    expect(outcomes[1]).toMatchObject({ ruleId: "flagged-rule", flagsApplied: [{ flag: "flagged", value: true }], movedTo: null });
  });

  it("only the first matching live rule's move action actually moves the message (Review Focus)", () => {
    const first = rule({ id: "first", actions: [{ type: "move", mailbox: "Newsletter" }] });
    const second = rule({ id: "second", actions: [{ type: "move", mailbox: "Archive" }] });
    const outcomes = planActions(envelope(), [first, second]);
    expect(outcomes[0]).toMatchObject({ ruleId: "first", movedTo: "Newsletter" });
    expect(outcomes[1]).toMatchObject({ ruleId: "second", movedTo: null });
  });

  it("a dry-run rule always reports its own move, independent of other rules' claims", () => {
    const dryRunFirst = rule({ id: "dry", dryRun: true, actions: [{ type: "move", mailbox: "Newsletter" }] });
    const live = rule({ id: "live", actions: [{ type: "move", mailbox: "Archive" }] });
    const outcomes = planActions(envelope(), [dryRunFirst, live]);
    expect(outcomes[0]).toMatchObject({ ruleId: "dry", dryRun: true, movedTo: "Newsletter" });
    expect(outcomes[1]).toMatchObject({ ruleId: "live", dryRun: false, movedTo: "Archive" });
  });

  it("a rule with both a flag and a move action reports both", () => {
    const combined = rule({
      id: "combined",
      actions: [{ type: "flag", flag: "seen", value: true }, { type: "move", mailbox: "Newsletter" }],
    });
    const outcomes = planActions(envelope(), [combined]);
    expect(outcomes[0]).toMatchObject({
      ruleId: "combined",
      flagsApplied: [{ flag: "seen", value: true }],
      movedTo: "Newsletter",
    });
  });
});

describe("readRules", () => {
  it("returns an empty array when the file does not exist", async () => {
    expect(await readRules(join(tmpdir(), "himalaya-web-rules-test-missing", "rules.json"))).toEqual([]);
  });

  it("parses a valid rule, defaulting enabled/dryRun when present as booleans", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, JSON.stringify([{
        id: "r1", account: "andre", enabled: true, dryRun: false,
        condition: { field: "from", match: "contains", value: "newsletter@example.test" },
        actions: [{ type: "flag", flag: "seen", value: true }],
      }]));
      const rules = await readRules(path);
      expect(rules).toEqual([{
        id: "r1", account: "andre", enabled: true, dryRun: false,
        condition: { field: "from", match: "contains", value: "newsletter@example.test" },
        actions: [{ type: "flag", flag: "seen", value: true }],
      }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drops one invalid entry but keeps loading the rest of the file (Review Focus)", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, JSON.stringify([
        { id: "bad", account: "andre", condition: { field: "nonsense", match: "contains", value: "x" }, actions: [] },
        {
          id: "good", account: "andre", enabled: true, dryRun: false,
          condition: { field: "subject", match: "contains", value: "digest" },
          actions: [{ type: "move", mailbox: "Newsletter" }],
        },
      ]));
      const rules = await readRules(path);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe("good");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drops a rule whose dryRun or enabled is present but not a boolean, rather than coercing it to false (Review Focus: the safety valve must fail closed)", async () => {
    // A hand-edited rules.json is exactly where a JSON string "true" (quoted)
    // instead of a real boolean true is a realistic mistake. Coercing an
    // invalid dryRun to false would silently turn the safety valve into a
    // LIVE rule; coercing an invalid enabled to false is safe in isolation
    // but inconsistent with how every other field in this parser behaves
    // (drop the rule, don't guess). Both must drop the rule.
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, JSON.stringify([
        {
          id: "quoted-dry-run", account: "andre", enabled: true, dryRun: "true",
          condition: { field: "from", match: "contains", value: "x" },
          actions: [{ type: "move", mailbox: "Newsletter" }],
        },
        {
          id: "numeric-enabled", account: "andre", enabled: 1, dryRun: false,
          condition: { field: "from", match: "contains", value: "x" },
          actions: [{ type: "move", mailbox: "Newsletter" }],
        },
        {
          id: "valid", account: "andre", enabled: true, dryRun: true,
          condition: { field: "from", match: "contains", value: "x" },
          actions: [{ type: "move", mailbox: "Newsletter" }],
        },
      ]));
      const rules = await readRules(path);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe("valid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns an empty array for malformed JSON, without throwing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, "{not valid json");
      expect(await readRules(path)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  describe("logging (Review Focus: the only feedback channel for a hand-edited file)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("names the dropped rule's id and the reason in the drop log, not just the file path", async () => {
      const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
      const path = join(directory, "rules.json");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await writeFile(path, JSON.stringify([
          { id: "missing-actions", account: "andre", condition: { field: "from", match: "contains", value: "x" }, actions: [] },
        ]));
        await readRules(path);
        expect(stderr).toHaveBeenCalledTimes(1);
        const logged = stderr.mock.calls[0]?.[0] as string;
        expect(logged).toContain("missing-actions");
        expect(logged).toMatch(/action/i);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("falls back to the entry's index when a dropped rule has no usable id", async () => {
      const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
      const path = join(directory, "rules.json");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await writeFile(path, JSON.stringify([{ account: "andre", condition: {}, actions: [] }]));
        await readRules(path);
        const logged = stderr.mock.calls[0]?.[0] as string;
        expect(logged).toMatch(/index 0|entry 0|#0/);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("logs one line when the whole file fails to parse, distinguishing it from a missing file", async () => {
      const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
      const path = join(directory, "rules.json");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await writeFile(path, "{not valid json");
        expect(await readRules(path)).toEqual([]);
        expect(stderr).toHaveBeenCalled();
        expect(stderr.mock.calls[0]?.[0]).toContain(path);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("reports a read error other than a missing file", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      // A directory in place of the file fails with EISDIR, not ENOENT.
      expect(await readRules(tmpdir())).toEqual([]);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls[0]?.[0]).toContain("cannot read");
    });

    it("stays silent when the file simply does not exist (the documented inert default)", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await readRules(join(tmpdir(), "himalaya-web-rules-test-missing-for-log-check", "rules.json"));
      expect(stderr).not.toHaveBeenCalled();
    });
  });
});
