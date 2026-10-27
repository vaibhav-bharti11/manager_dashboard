import test from "node:test";
import assert from "node:assert/strict";
import {
  employeeInput,
  requireAdmin,
} from "../supabase/functions/employee-admin/validation.mjs";
const good = {
  name: "Test Manager",
  email: "manager@example.invalid",
  password: "Fictitious-pass-123",
  restaurant_id: "kampai",
};
test("only verified admins can provision employees", () => {
  assert.throws(() => requireAdmin(null), /Administrator/);
  assert.throws(() => requireAdmin({ role: "manager" }), /Administrator/);
  assert.equal(requireAdmin({ id: "one", role: "admin" }), "one");
});
test("employee records are scoped and cannot grant admin access", () => {
  assert.throws(() => employeeInput({ ...good, role: "admin" }), /manager/);
  assert.throws(
    () => employeeInput({ ...good, restaurant_id: "unknown" }),
    /restaurant/,
  );
  assert.deepEqual(
    employeeInput({
      ...good,
      email: " Manager@Example.invalid ",
      name: " Test Manager ",
    }),
    good,
  );
});
test("account creation rejects missing identity and weak credentials", () => {
  for (const p of [
    { ...good, name: "" },
    { ...good, email: "broken" },
    { ...good, password: "short" },
    { ...good, password: "x".repeat(73) },
  ])
    assert.throws(() => employeeInput(p));
});
