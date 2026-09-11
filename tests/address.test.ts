import { test } from "node:test";
import assert from "node:assert/strict";

import { addressed } from "../src/client/address.ts";
import { intentOf } from "../src/client/commands.ts";

test("the console's own lines are said to ma'am when asked, and left alone for sir", () => {
  assert.equal(addressed("Renamed to “Budget”, sir.", "sir"), "Renamed to “Budget”, sir.");
  assert.equal(addressed("Renamed to “Budget”, sir.", "madam"), "Renamed to “Budget”, ma'am.");
  assert.equal(addressed("Delete it for good, sir?", "madam"), "Delete it for good, ma'am?");
  assert.equal(addressed("Sir, the board is empty.", "madam"), "Ma'am, the board is empty.");
  assert.equal(addressed("Very good, sir. Opening it now.", "madam"), "Very good, ma'am. Opening it now.");
  assert.equal(addressed("SIR ›", "madam"), "MA'AM ›");
  // a name is not a form of address
  assert.equal(addressed("Opened “Sir David Attenborough”, sir.", "madam"), "Opened “Sir David Attenborough”, ma'am.");
});

test("how JARVIS addresses you can be said", () => {
  assert.deepEqual(intentOf("call me ma'am"), { name: "set_address", address: "madam" });
  assert.deepEqual(intentOf("please address me as madam"), { name: "set_address", address: "madam" });
  assert.deepEqual(intentOf("call me sir again"), { name: "set_address", address: "sir" });
});
