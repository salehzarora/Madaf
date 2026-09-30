import type { Instrumentation } from "next";
import { unstable_rethrow } from "next/navigation";
import { logServerDiagnostic } from "@/lib/monitoring/server-diagnostics";

// React/Next can report the same exception more than once during rendering.
// Weak references retain no request data and do not keep errors alive.
const reported = new WeakSet<object>();

export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  try {
    // Observe only: Next retains responsibility for redirect/not-found and
    // dynamic-render control flow. Never propagate an instrumentation failure.
    try { unstable_rethrow(error); } catch { return; }
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    logServerDiagnostic("server_request_unexpected", context.routePath);
  } catch {
    // The hook must not alter the original response, even for malformed input.
  }
};
