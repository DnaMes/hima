import { describe, expect, it } from "vitest";

import { countRemoteImages, readImageSenders, writeImageSenders } from "./remote-images.js";

describe("countRemoteImages", () => {
  it("counts http and https images only", () => {
    expect(countRemoteImages('<p><img src="https://t.example/p.gif"><IMG alt=x SRC=\'http://t.example/a.png\'><img src="cid:logo"><img src="data:image/png;base64,AA"></p>')).toBe(2);
    expect(countRemoteImages(null)).toBe(0);
    expect(countRemoteImages("<p>no images</p>")).toBe(0);
  });
});

describe("image sender storage", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  };

  it("round-trips and ignores corrupt or foreign entries", () => {
    const storage = memory();
    writeImageSenders(storage, new Set(["a@example.test"]));
    expect([...readImageSenders(storage)]).toEqual(["a@example.test"]);
    storage.setItem("himalaya-web-image-senders-v1", '["a@x.test", 5, "no-at"]');
    expect([...readImageSenders(storage)]).toEqual(["a@x.test"]);
    storage.setItem("himalaya-web-image-senders-v1", "{broken");
    expect(readImageSenders(storage).size).toBe(0);
  });
});
