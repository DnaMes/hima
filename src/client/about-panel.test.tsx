// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { AboutPanel } from "./about-panel.js";

describe("AboutPanel", () => {
  it("shows the version from package.json, the licence and the label", () => {
    const html = renderToString(<AboutPanel onClose={() => undefined} />);
    expect(html).toContain(`Hima v${packageJson.version}`);
    expect(html).toContain(`Licence: ${packageJson.license}`);
    expect(html).toContain("Part of erdlabs");
    expect(html).toContain('role="dialog"');
  });
});
