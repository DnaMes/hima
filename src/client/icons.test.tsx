import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  IconCompose,
  IconRefresh,
  IconSearch,
  IconFilter,
  IconInbox,
  IconFolder,
  IconSettings,
  IconStar,
  IconFlag,
  IconTrash,
  IconMove,
  IconReply,
  IconReplyAll,
  IconForward,
  IconSnooze,
  IconTag,
  IconSparkles,
  IconPaperclip,
  IconShield,
  IconAlertTriangle,
  IconCheck,
  IconCheckSquare,
  IconSquare,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCommand,
  IconKeyboard,
  IconRules,
  IconTheme,
  IconDensityCompact,
  IconDensityComfortable,
  IconPrinter,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconArrowUp,
  IconArrowDown,
  IconMail,
  IconArchive,
} from "./icons.js";

describe("Vector icons", () => {
  const icons = [
    ["IconCompose", IconCompose],
    ["IconRefresh", IconRefresh],
    ["IconSearch", IconSearch],
    ["IconFilter", IconFilter],
    ["IconInbox", IconInbox],
    ["IconFolder", IconFolder],
    ["IconSettings", IconSettings],
    ["IconStar", IconStar],
    ["IconFlag", IconFlag],
    ["IconTrash", IconTrash],
    ["IconMove", IconMove],
    ["IconReply", IconReply],
    ["IconReplyAll", IconReplyAll],
    ["IconForward", IconForward],
    ["IconSnooze", IconSnooze],
    ["IconTag", IconTag],
    ["IconSparkles", IconSparkles],
    ["IconPaperclip", IconPaperclip],
    ["IconShield", IconShield],
    ["IconAlertTriangle", IconAlertTriangle],
    ["IconCheck", IconCheck],
    ["IconCheckSquare", IconCheckSquare],
    ["IconSquare", IconSquare],
    ["IconChevronDown", IconChevronDown],
    ["IconChevronRight", IconChevronRight],
    ["IconClose", IconClose],
    ["IconCommand", IconCommand],
    ["IconKeyboard", IconKeyboard],
    ["IconRules", IconRules],
    ["IconTheme", IconTheme],
    ["IconDensityCompact", IconDensityCompact],
    ["IconDensityComfortable", IconDensityComfortable],
    ["IconPrinter", IconPrinter],
    ["IconCopy", IconCopy],
    ["IconEye", IconEye],
    ["IconEyeOff", IconEyeOff],
    ["IconArrowUp", IconArrowUp],
    ["IconArrowDown", IconArrowDown],
    ["IconMail", IconMail],
    ["IconArchive", IconArchive],
  ] as const;

  for (const [name, Component] of icons) {
    it(`renders ${name} with valid svg markup`, () => {
      const html = renderToString(<Component size={18} />);
      expect(html).toContain("<svg");
      expect(html).toContain('width="18"');
      expect(html).toContain('height="18"');
      expect(html).toContain('viewBox="0 0 24 24"');
    });
  }

  it("supports filled flag and star variants", () => {
    const starHtml = renderToString(<IconStar size={16} filled={true} />);
    expect(starHtml).toContain('fill="currentColor"');
    const flagHtml = renderToString(<IconFlag size={16} filled={true} />);
    expect(flagHtml).toContain('fill="currentColor"');
  });
});
