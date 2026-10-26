import { describe, expect, it } from "vitest";

import { previewFor } from "./attachment-preview.js";

const item = (mime: string | null, filename: string | null, size = 1000) => ({ mime, filename, size });

describe("previewFor", () => {
  it("allows raster images, pdf and plain text by mime", () => {
    expect(previewFor(item("image/PNG; name=x", "x"))).toEqual({ kind: "image", type: "image/png" });
    expect(previewFor(item("application/pdf", "a.pdf"))?.kind).toBe("pdf");
    expect(previewFor(item("text/plain", "n.txt"))?.kind).toBe("text");
  });

  it("never previews active content, whatever the file name says", () => {
    expect(previewFor(item("image/svg+xml", "logo.svg"))).toBeNull();
    expect(previewFor(item("text/html", "page.html"))).toBeNull();
    expect(previewFor(item("text/html", "report.pdf"))).toBeNull();
    expect(previewFor(item("application/javascript", "x.txt"))).toBeNull();
  });

  it("ignores inherited object keys as types or extensions", () => {
    expect(previewFor(item("constructor", "x"))).toBeNull();
    expect(previewFor(item(null, "x.constructor"))).toBeNull();
    expect(previewFor(item("__proto__", "x"))).toBeNull();
  });

  it("falls back to the extension only for an unknown type, and respects the size cap", () => {
    expect(previewFor(item("application/octet-stream", "scan.JPG"))?.type).toBe("image/jpeg");
    expect(previewFor(item(null, "notes.txt"))?.kind).toBe("text");
    expect(previewFor(item(null, "archive.zip"))).toBeNull();
    expect(previewFor(item("image/png", "big.png", 20 * 1024 * 1024))).toBeNull();
  });
});
