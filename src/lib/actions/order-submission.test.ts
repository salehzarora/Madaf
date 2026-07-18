/**
 * PILOT-OPS-AUDIT-008-FIX1 — shared order-submission guard helpers.
 *
 * The DB is the authoritative idempotency gate; these client/action guards only
 * (a) reject an obviously-malformed key before the round-trip and (b) recognize
 * the DB idempotency conflict (MDF40) so the UI can offer a fresh attempt.
 *
 * Runner: `npm run test:order-submission`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isSubmissionConflict,
  isSubmissionKey,
} from "@/lib/actions/order-submission";

test("isSubmissionKey accepts a v4-shaped UUID and rejects everything else", () => {
  assert.equal(isSubmissionKey("1a110000-0000-4000-8000-000000000001"), true);
  assert.equal(isSubmissionKey(crypto.randomUUID()), true, "a real UUID passes");
  assert.equal(isSubmissionKey(""), false);
  assert.equal(isSubmissionKey("not-a-uuid"), false);
  assert.equal(
    isSubmissionKey("1a110000000040008000000000000001"),
    false,
    "no dashes → rejected",
  );
  assert.equal(isSubmissionKey("../../etc/passwd"), false);
  assert.equal(isSubmissionKey("<script>alert(1)</script>"), false);
  assert.equal(isSubmissionKey(null), false);
  assert.equal(isSubmissionKey(undefined), false);
  assert.equal(isSubmissionKey(123), false);
});

test("isSubmissionConflict recognizes ONLY the MDF40 conflict error", () => {
  assert.equal(
    isSubmissionConflict(
      new Error("[madaf/data] order submission key reused with a different request"),
    ),
    true,
  );
  assert.equal(isSubmissionConflict(new Error("insufficient stock")), false);
  assert.equal(isSubmissionConflict(new Error("catalog changed")), false);
  assert.equal(isSubmissionConflict("submission key reused"), false, "a non-Error is not a conflict");
  assert.equal(isSubmissionConflict(null), false);
  assert.equal(isSubmissionConflict(undefined), false);
});
