import { describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import { applyContact, collectContacts, suggestContacts } from "./contacts.js";

let counter = 0;
const envelope = (from: string, to: string[]): Envelope => ({
  id: String(++counter), date: null, flags: [], subject: "s", size: 1, hasAttachment: false,
  from: [{ email: from, name: from.startsWith("anna") ? "Anna Beispiel" : null }],
  to: to.map((email) => ({ email, name: null })),
});

describe("contacts", () => {
  const contacts = collectContacts(
    [envelope("anna@example.test", ["me@example.test"]), envelope("anna@example.test", ["bob@example.test"]), envelope("carl@example.test", ["me@example.test"])],
    ["ME@example.test"],
  );

  it("counts addresses, names them when known, and skips the operator's own", () => {
    expect(contacts.map((contact) => contact.email)).toEqual(["anna@example.test", "bob@example.test", "carl@example.test"]);
    expect(contacts[0]?.name).toBe("Anna Beispiel");
  });

  it("counts a message that appears in two lists only once", () => {
    const same = envelope("bob@example.test", ["x@example.test"]);
    const other = envelope("dora@example.test", ["x@example.test"]);
    const list = collectContacts([same, same, other, other], []);
    expect(list.map((contact) => contact.email)).toEqual(["x@example.test", "bob@example.test", "dora@example.test"]);
  });

  it("suggests for the last typed recipient only, needs two characters and skips present ones", () => {
    expect(suggestContacts("a", contacts)).toEqual([]);
    expect(suggestContacts("an", contacts).map((contact) => contact.email)).toEqual(["anna@example.test"]);
    expect(suggestContacts("anna@example.test, ca", contacts).map((contact) => contact.email)).toEqual(["carl@example.test"]);
    expect(suggestContacts("anna@example.test, an", contacts)).toEqual([]);
    expect(suggestContacts("beispiel", contacts).map((contact) => contact.email)).toEqual(["anna@example.test"]);
  });

  it("replaces the typed fragment with the chosen address and a separator", () => {
    expect(applyContact("bob@example.test, an", contacts[0]!)).toBe("bob@example.test, anna@example.test, ");
    expect(applyContact("an", contacts[0]!)).toBe("anna@example.test, ");
  });
});
