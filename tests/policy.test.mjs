import test from "node:test";
import assert from "node:assert/strict";
import {
  stateOf,
  ledgerEntry,
  score,
  weekStart,
  resolveWindow,
  canAccess,
  validateResponses,
  configuredWeekStart,
} from "../src/policy.mjs";
test("approved Sunday noon reset uses the previous week before noon", () => {
  assert.equal(
    configuredWeekStart(
      new Date("2026-10-25T06:29:59Z"),
      "Asia/Kolkata",
      "12:00",
    ),
    "2026-10-18",
  );
  assert.equal(
    configuredWeekStart(
      new Date("2026-10-25T06:30:00Z"),
      "Asia/Kolkata",
      "12:00",
    ),
    "2026-10-25",
  );
});
const occurrence = {
  id: "one",
  enabled: true,
  opens_at: "2026-10-27T04:30:00Z",
  deadline: "2026-10-27T06:30:00Z",
  manager_id: "a",
  restaurant_id: "r",
  reward: 10,
};
test("unconfigured policies never become missed", () =>
  assert.equal(
    stateOf({ ...occurrence, enabled: false }, new Date("2027-01-01")),
    "Policy not configured",
  ));
test("start inclusive, end exclusive and future not penalized", () => {
  assert.equal(
    stateOf(occurrence, new Date("2026-10-27T04:29:59.999Z")),
    "Not yet open",
  );
  assert.equal(stateOf(occurrence, new Date(occurrence.opens_at)), "Open");
  assert.equal(
    stateOf(occurrence, new Date("2026-10-27T06:29:59.999Z")),
    "Open",
  );
  assert.equal(stateOf(occurrence, new Date(occurrence.deadline)), "Missed");
});
test("valid submission stays submitted after cutoff", () =>
  assert.equal(
    stateOf(
      { ...occurrence, submitted_at: "2026-10-27T05:00:00Z" },
      new Date("2027-01-01"),
    ),
    "Submitted",
  ));
test("one penalty per occurrence on retry; three misses deduct sixty", () => {
  const ledger = [];
  for (let i = 0; i < 3; i++) {
    ledgerEntry(ledger, { ...occurrence, id: String(i) }, "missed");
    ledgerEntry(ledger, { ...occurrence, id: String(i) }, "missed");
  }
  assert.equal(ledger.length, 3);
  assert.equal(score(100, ledger), 40);
  assert.equal(score(null, ledger), null);
});
test("reward once, and never both reward and penalty", () => {
  const ledger = [];
  ledgerEntry(ledger, occurrence, "submitted");
  ledgerEntry(ledger, occurrence, "missed");
  assert.equal(score(100, ledger), 110);
});
test("overnight deadline belongs to next calendar day in IST", () => {
  const w = resolveWindow("2026-10-27", "22:00", "02:00", 330);
  assert.equal(w.opens_at, "2026-10-27T16:30:00.000Z");
  assert.equal(w.deadline, "2026-10-27T20:30:00.000Z");
});
test("Sunday IST boundary preserves Saturday before midnight", () => {
  assert.equal(weekStart(new Date("2026-10-24T18:29:59Z"), 330), "2026-10-18");
  assert.equal(weekStart(new Date("2026-10-24T18:30:00Z"), 330), "2026-10-25");
});
test("manager cannot read another restaurant; admin can", () => {
  assert.equal(canAccess({ role: "manager", restaurant_id: "a" }, "b"), false);
  assert.equal(canAccess({ role: "admin" }, "b"), true);
});
test("checklist requires every response; issues need action and owner", () => {
  assert.ok(validateResponses(["one"], {}));
  assert.ok(validateResponses(["one"], { 0: { status: "I" } }));
  assert.equal(
    validateResponses(["one"], { 0: { status: "D", initials: "AM" } }),
    null,
  );
});
