import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { createNotifier } from "./notify.js";

function fakeChild(): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  emitter.unref = vi.fn();
  return emitter;
}

describe("createNotifier", () => {
  afterEach(() => vi.clearAllMocks());

  it("spawns omarchy-notification-send with title, body, and a click-to-open --exec target, never a shell string", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("andre@example.test", "Neue Nachricht: Hallo");

    expect(spawn).toHaveBeenCalledWith(
      "omarchy-notification-send",
      ["andre@example.test", "Neue Nachricht: Hallo", "--exec", "xdg-open", "http://127.0.0.1:47831/"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("strips embedded CR/LF from title and body before spawning (Review Focus)", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("andre\r\nX-Injected: yes", "line1\nline2");

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]).toBe("andre X-Injected: yes");
    expect(args[1]).toBe("line1 line2");
  });

  it("truncates an overlong title or body instead of spawning an unbounded argv element", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("x".repeat(500), "y".repeat(500));

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]?.length).toBe(200);
    expect(args[1]?.length).toBe(200);
  });

  it("never throws when the spawned process itself errors (e.g. binary missing)", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    expect(() => notify("a", "b")).not.toThrow();
    expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow();
  });

  it("prefixes a leading dash with a space so the body can't be mistaken for a known omarchy-notification-send flag", () => {
    // omarchy-notification-send's own known_flag() check takes the second
    // positional as the description UNLESS it exactly matches a recognized
    // flag (--glyph=..., --urgency=..., --exec, etc.) — an IMAP-reported
    // sender/subject that happens to match one would otherwise be parsed as
    // an option instead of notification text (e.g. suppressing the body via
    // --glyph=X, or aborting the whole notification via --urgency=bogus).
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("--urgency=critical", "--glyph=pwned");

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]).toBe(" --urgency=critical");
    expect(args[1]).toBe(" --glyph=pwned");
  });

  it("leaves text with no leading dash untouched", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("andre@example.test", "Newsletter: 50% off today");

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]).toBe("andre@example.test");
    expect(args[1]).toBe("Newsletter: 50% off today");
  });

  it("unrefs the spawned child so it never keeps the process alive", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("a", "b");

    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
