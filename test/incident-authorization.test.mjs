import test from "node:test";
import assert from "node:assert/strict";
import { canManageIncident } from "../lib/incident-authorization.mjs";

test("Admin can manage incidents without AOR verification", () => {
  assert.equal(canManageIncident({ role: "admin" }), true);
});

test("Sub Admin is denied when jurisdiction is unverified", () => {
  assert.equal(canManageIncident({ role: "sub_admin" }), false);
});

test("Sub Admin is denied when jurisdiction verification fails", () => {
  assert.equal(
    canManageIncident({ role: "sub_admin", jurisdictionVerified: false }),
    false
  );
});

test("Sub Admin can manage an independently verified jurisdiction", () => {
  assert.equal(
    canManageIncident({ role: "sub_admin", jurisdictionVerified: true }),
    true
  );
});

test("Head cannot manage incidents", () => {
  assert.equal(canManageIncident({ role: "head" }), false);
});

test("Authorized user cannot manage incidents", () => {
  assert.equal(canManageIncident({ role: "authorized" }), false);
});

test("General user cannot manage incidents", () => {
  assert.equal(canManageIncident({ role: "general" }), false);
});

test("Missing role is denied", () => {
  assert.equal(canManageIncident({}), false);
});

test("Untrusted truthy values do not count as verification", () => {
  assert.equal(
    canManageIncident({
      role: "sub_admin",
      jurisdictionVerified: "true",
    }),
    false
  );
});
