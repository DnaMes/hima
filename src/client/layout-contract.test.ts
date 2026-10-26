import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("mail shell layout contract", () => {
  it("keeps the account tree scrollable and folder children indented", () => {
    expect(stylesheet).toMatch(/\.account-list,\s*\.envelope-list\s*\{(?=[^}]*overflow:\s*auto)(?=[^}]*min-height:\s*0)[^}]*\}/);
    expect(stylesheet).toMatch(/\.mailbox-children\s*\{[^}]*margin-left:\s*22px/);
  });

  it("lets the message list own remaining panel height", () => {
    const listRule = /\.account-list,\s*\.envelope-list\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    expect(listRule).toMatch(/flex:\s*1 1 auto/);
    expect(listRule).toMatch(/min-height:\s*0/);
  });

  it("tints the three areas from theme tokens with a coloured top line and title", () => {
    expect(stylesheet).toMatch(/\.accounts-panel\s*\{[^}]*background:\s*var\(--area-accounts\)[^}]*inset 0 3px 0 var\(--title-accounts\)/);
    expect(stylesheet).toMatch(/\.messages-panel\s*\{[^}]*background:\s*var\(--area-list\)[^}]*inset 0 3px 0 var\(--title-list\)/);
    expect(stylesheet).toMatch(/\.reader-panel\s*\{[^}]*background:\s*var\(--area-reader\)[^}]*inset 0 3px 0 var\(--title-reader\)/);
    expect(stylesheet).toMatch(/\.accounts-panel \.eyebrow\s*\{[^}]*var\(--title-accounts\)/);
    expect(stylesheet).toMatch(/\.messages-panel \.eyebrow\s*\{[^}]*var\(--title-list\)/);
    expect(stylesheet).toMatch(/\.reader-panel \.eyebrow\s*\{[^}]*var\(--title-reader\)/);
  });

  it("declares Midnight fallbacks for the new tokens before the theme is applied", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    for (const token of ["--area-accounts", "--area-list", "--area-reader", "--title-accounts", "--title-list", "--title-reader"]) {
      expect(root).toContain(`${token}:`);
    }
    for (let index = 0; index < 8; index += 1) expect(root).toContain(`--account-hue-${index}:`);
  });
});
