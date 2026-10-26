import { describe, expect, it } from "vitest";

import { filterCommands } from "./command-palette.js";

const run = () => undefined;
const commands = [
  { id: "a", label: "Alle Eingänge", run },
  { id: "b", label: "alpha / Sent", hint: "Ordner", run },
  { id: "c", label: "beta / Archive", hint: "Ordner", run },
];

describe("filterCommands", () => {
  it("keeps everything for an empty query", () => {
    expect(filterCommands(commands, "  ")).toHaveLength(3);
  });

  it("matches every word in any order, ignoring case, over label and hint", () => {
    expect(filterCommands(commands, "SENT alpha").map((command) => command.id)).toEqual(["b"]);
    expect(filterCommands(commands, "ordner").map((command) => command.id)).toEqual(["b", "c"]);
    expect(filterCommands(commands, "nichts")).toEqual([]);
  });
});
