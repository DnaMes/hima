import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ProviderLogo,
  providerLabel,
  LogoGmail,
  LogoiCloud,
  LogoGoneo,
  LogoLimaCity,
  LogoOutlook,
  LogoFastmail,
  LogoProton,
  LogoGmx,
  LogoWebde,
  LogoPosteo,
  LogoMailboxOrg,
  LogoStrato,
  LogoHetzner,
  LogoIonos,
  LogoCustomDomain,
} from "./provider-logos.js";

describe("Provider logos", () => {
  const logos = [
    ["gmail", LogoGmail],
    ["icloud", LogoiCloud],
    ["goneo", LogoGoneo],
    ["lima-city", LogoLimaCity],
    ["outlook", LogoOutlook],
    ["fastmail", LogoFastmail],
    ["proton", LogoProton],
    ["gmx", LogoGmx],
    ["webde", LogoWebde],
    ["posteo", LogoPosteo],
    ["mailboxorg", LogoMailboxOrg],
    ["strato", LogoStrato],
    ["hetzner", LogoHetzner],
    ["ionos", LogoIonos],
    ["custom", LogoCustomDomain],
  ] as const;

  for (const [provider, Component] of logos) {
    it(`renders ${provider} logo with valid SVG`, () => {
      const html = renderToString(<Component size={24} />);
      expect(html).toContain("<svg");
      expect(html).toContain('width="24"');
      expect(html).toContain('height="24"');
      expect(html).toContain('viewBox="0 0 24 24"');
    });

    it(`dispatches ${provider} through ProviderLogo correctly`, () => {
      const html = renderToString(<ProviderLogo provider={provider} size={20} />);
      expect(html).toContain("<svg");
      expect(html).toContain('width="20"');
    });
  }

  it("handles fallback for unknown provider", () => {
    const html = renderToString(<ProviderLogo provider="unknown-domain" size={16} />);
    expect(html).toContain("<svg");
    expect(html).toContain('width="16"');
  });

  it("formats human-readable provider labels", () => {
    expect(providerLabel("gmail")).toBe("Google Mail");
    expect(providerLabel("icloud")).toBe("Apple iCloud");
    expect(providerLabel("goneo")).toBe("goneo");
    expect(providerLabel("lima-city")).toBe("lima-city");
    expect(providerLabel("outlook")).toBe("Outlook / M365");
    expect(providerLabel("unknown")).toBe("IMAP/SMTP Mail");
  });
});
