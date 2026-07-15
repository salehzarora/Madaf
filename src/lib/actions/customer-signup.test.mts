/**
 * Behavioural tests for approveSignupRequestAction's control flow (C2 review).
 *
 * Codex asked for BEHAVIOURAL proof (not source inspection) that the S2 targeted
 * lookup preserves the failure-vs-not-found contract and the duplicate-guard
 * semantics, and that the authoritative approve RPC is the only mutation:
 *   • genuine not-found (reader → undefined)  ⇒ the guard is skipped and the
 *     approve RPC is still invoked (it rejects the missing request);
 *   • reader query/transport FAILURE (reader throws) ⇒ the action returns a safe
 *     { ok:false } and the approve RPC is NOT invoked; no raw error leaks;
 *   • duplicate hit ⇒ { ok:false, duplicates } and NO approve RPC call;
 *   • confirmDuplicate === true ⇒ the targeted read + duplicate check are skipped
 *     entirely and approve is invoked;
 *   • confirmDuplicate === false ⇒ the targeted read runs;
 *   • an invalid request id short-circuits before either the reader or the RPC.
 *
 * The data layer + RPC are mocked so the ACTION's branching is what is exercised.
 * The real DB state machine + concurrency are covered by the pgTAP + live tests.
 *
 * Runner: `npm run test:signup-action` (needs --experimental-test-module-mocks).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Per-test controllable data-layer behaviour + call spies.
let getImpl: (id: string) => Promise<{ id: string; name: string; phone: string | null } | undefined>;
let dupImpl: (input: { name?: string; phone?: string }) => Promise<
  { id: string; name: string; matchType: "phone" | "name"; isActive: boolean; city: { ar: string; he: string; en: string } }[]
>;
let approveImpl: (id: string) => Promise<{ customerId: string }>;
const getCalls: string[] = [];
const approveCalls: string[] = [];
const dupCalls: { name?: string; phone?: string }[] = [];

function resetSpies() {
  getCalls.length = 0;
  approveCalls.length = 0;
  dupCalls.length = 0;
}

// Silence the action's server-side console.error (failure paths log intentionally).
mock.method(console, "error", () => {});

mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});
mock.module("@/lib/data/customers", {
  namedExports: {
    findCustomerDuplicates: (input: { name?: string; phone?: string }) => {
      dupCalls.push(input);
      return dupImpl(input);
    },
  },
});
mock.module("@/lib/data/customer-signup", {
  namedExports: {
    getSignupRequestForApproval: (id: string) => {
      getCalls.push(id);
      return getImpl(id);
    },
    approveSignupRequest: (id: string) => {
      approveCalls.push(id);
      return approveImpl(id);
    },
    // Unused by the approve action but imported by the module.
    rejectSignupRequest: async () => {},
    insertSignupLink: async () => ({ linkId: "x" }),
    revokeSignupLink: async () => {},
    submitSignupRequest: async () => true,
  },
});

const { approveSignupRequestAction } = await import("@/lib/actions/customer-signup");

test("targeted lookup success + no duplicates ⇒ approve invoked, ok", async () => {
  resetSpies();
  getImpl = async (id) => ({ id, name: "Shop", phone: "050-1" });
  dupImpl = async () => [];
  approveImpl = async () => ({ customerId: "cust-1" });

  const res = await approveSignupRequestAction({ requestId: "req-1", locale: "he" });

  assert.deepEqual(res, { ok: true, customerId: "cust-1" });
  assert.deepEqual(getCalls, ["req-1"], "targeted read ran");
  assert.deepEqual(dupCalls, [{ name: "Shop", phone: "050-1" }], "duplicate check used name+phone");
  assert.deepEqual(approveCalls, ["req-1"], "approve RPC invoked");
});

test("genuine not-found (reader → undefined) ⇒ guard skipped, approve STILL invoked", async () => {
  resetSpies();
  getImpl = async () => undefined;
  dupImpl = async () => {
    throw new Error("duplicate check must not run when the request is not found");
  };
  approveImpl = async () => ({ customerId: "cust-2" });

  const res = await approveSignupRequestAction({ requestId: "req-2", locale: "en" });

  assert.deepEqual(res, { ok: true, customerId: "cust-2" });
  assert.deepEqual(getCalls, ["req-2"], "targeted read ran");
  assert.deepEqual(dupCalls, [], "duplicate check skipped on not-found");
  assert.deepEqual(approveCalls, ["req-2"], "approve RPC IS invoked on not-found (RPC is authoritative)");
});

test("reader query/transport FAILURE (reader throws) ⇒ safe {ok:false}, approve NOT invoked, no raw error", async () => {
  resetSpies();
  getImpl = async () => {
    throw new Error("SENSITIVE-DB-INTERNAL: relation ... does not exist");
  };
  approveImpl = async () => {
    throw new Error("approve must not be called after a lookup failure");
  };

  const res = await approveSignupRequestAction({ requestId: "req-3", locale: "ar" });

  assert.deepEqual(res, { ok: false }, "returns the safe failure result");
  assert.deepEqual(approveCalls, [], "approve RPC NOT invoked when the lookup fails");
  assert.ok(
    !JSON.stringify(res).includes("SENSITIVE"),
    "no raw backend error string leaks into the result",
  );
});

test("duplicate hit ⇒ {ok:false, duplicates}, approve NOT invoked", async () => {
  resetSpies();
  getImpl = async (id) => ({ id, name: "Dup Store", phone: "050-9" });
  const dups = [
    { id: "cX", name: "Dup Store", matchType: "phone" as const, isActive: true, city: { ar: "", he: "", en: "" } },
  ];
  dupImpl = async () => dups;
  approveImpl = async () => {
    throw new Error("approve must not run while an unconfirmed duplicate exists");
  };

  const res = await approveSignupRequestAction({ requestId: "req-4", locale: "he" });

  assert.equal(res.ok, false);
  assert.deepEqual(res.duplicates, dups, "returns the duplicate candidates for confirmation");
  assert.deepEqual(approveCalls, [], "approve RPC NOT invoked on an unconfirmed duplicate");
});

test("confirmDuplicate === true ⇒ targeted read + duplicate check SKIPPED, approve invoked", async () => {
  resetSpies();
  getImpl = async () => {
    throw new Error("targeted read must be skipped when confirmDuplicate is true");
  };
  dupImpl = async () => {
    throw new Error("duplicate check must be skipped when confirmDuplicate is true");
  };
  approveImpl = async () => ({ customerId: "cust-5" });

  const res = await approveSignupRequestAction({ requestId: "req-5", locale: "he", confirmDuplicate: true });

  assert.deepEqual(res, { ok: true, customerId: "cust-5" });
  assert.deepEqual(getCalls, [], "targeted read skipped on explicit override");
  assert.deepEqual(dupCalls, [], "duplicate check skipped on explicit override");
  assert.deepEqual(approveCalls, ["req-5"], "approve RPC invoked");
});

test("confirmDuplicate === false ⇒ targeted read runs (guard is active)", async () => {
  resetSpies();
  getImpl = async (id) => ({ id, name: "Shop", phone: "050-1" });
  dupImpl = async () => [];
  approveImpl = async () => ({ customerId: "cust-6" });

  const res = await approveSignupRequestAction({ requestId: "req-6", locale: "he", confirmDuplicate: false });

  assert.deepEqual(res, { ok: true, customerId: "cust-6" });
  assert.deepEqual(getCalls, ["req-6"], "targeted read runs when confirmDuplicate is false");
  assert.deepEqual(approveCalls, ["req-6"], "approve RPC invoked");
});

test("an invalid request id short-circuits before the reader or the RPC", async () => {
  resetSpies();
  getImpl = async () => {
    throw new Error("reader must not run for an invalid id");
  };
  approveImpl = async () => {
    throw new Error("approve must not run for an invalid id");
  };

  const res = await approveSignupRequestAction({ requestId: "bad id!", locale: "he" });

  assert.deepEqual(res, { ok: false });
  assert.deepEqual(getCalls, [], "reader not called for an invalid id");
  assert.deepEqual(approveCalls, [], "approve not called for an invalid id");
});
