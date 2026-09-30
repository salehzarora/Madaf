import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
// Match Next's RSC navigation alias in this standalone Node harness. These are
// the installed framework implementations, not simulated control-flow errors.
import * as navigation from "next/dist/client/components/navigation.react-server";
import { logServerDiagnostic } from "./server-diagnostics";
mock.module("next/navigation", { namedExports: { ...navigation } });
const { onRequestError } = await import("@/instrumentation");
const { notFound, redirect, permanentRedirect } = navigation;

const envKeys = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV", "NEXT_RUNTIME"] as const;
const savedEnv = envKeys.map((key) => [key, process.env[key]] as const);
let output: string[];
beforeEach(() => {
  output = [];
  for (const method of ["error", "warn"] as const) {
    mock.method(console, method, (...args: unknown[]) => {
      assert.equal(args.length, 1);
      assert.equal(typeof args[0], "string");
      output.push(args[0] as string);
    });
  }
});
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const request = { path: "/ar/shop/PRIVATE_TOKEN?key=SECRET", method: "POST", headers: { authorization: "Bearer SECRET", cookie: "OTP=SECRET" } };
const context = (routePath = "/[locale]/shop/[token]") => ({
  routerKind: "App Router" as const, routeType: "render" as const,
  routePath, revalidateReason: undefined,
});

test("output has only eight bounded safe fields, validated release and coarse environment/runtime", () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "ABCDEF1234567890abcdef1234567890abcdef12";
  process.env.VERCEL_ENV = "preview";
  process.env.NEXT_RUNTIME = "nodejs";
  logServerDiagnostic("server_request_unexpected", "/[locale]/admin/orders/[id]");
  const event = JSON.parse(output[0]);
  assert.deepEqual(Object.keys(event).sort(), ["event", "severity", "timestamp", "environment", "runtime", "commit", "operation", "route"].sort());
  assert.equal(event.event, "server_request_unexpected");
  assert.equal(event.severity, "error");
  assert.equal(event.operation, "request");
  assert.equal(event.environment, "preview");
  assert.equal(event.runtime, "nodejs");
  assert.equal(event.commit, "abcdef1");
  assert.equal(event.route, "/[locale]/admin/orders/[id]");
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.ok(output[0].length < 512);
});

test("invalid environment/runtime/commit values cannot enter output", () => {
  for (const key of envKeys) process.env[key] = "SECRET=https://private.example?token=SECRET";
  logServerDiagnostic("server_request_unexpected");
  assert.equal(JSON.parse(output[0]).commit, "unknown");
  assert.equal(JSON.parse(output[0]).runtime, "unknown");
  assert.doesNotMatch(output[0], /SECRET|https|private\.example/);
});

test("unknown event codes and non-string keys cannot be serialized", () => {
  logServerDiagnostic("SECRET" as Parameters<typeof logServerDiagnostic>[0]);
  logServerDiagnostic("toString" as Parameters<typeof logServerDiagnostic>[0]);
  const key = { toString: () => "server_request_unexpected", secret: "SECRET" };
  logServerDiagnostic(key as unknown as Parameters<typeof logServerDiagnostic>[0]);
  assert.equal(output.length, 0);
});

test("actual IDs, token paths, query strings, URLs, arbitrary metadata and oversized inputs become unknown", () => {
  for (const route of [
    "/ar/shop/PRIVATE_TOKEN", "/[locale]/shop/PRIVATE_TOKEN",
    "/[locale]/admin/orders/PRIVATE_ID", "/[locale]/shop/[token]?key=SECRET",
    "https://private.example/signed?token=SECRET", "SECRET".repeat(200),
    { toJSON: () => { throw new Error("must not serialize"); }, token: "SECRET" },
  ]) logServerDiagnostic("server_request_unexpected", route);
  assert.equal(output.length, 7);
  for (const line of output) {
    assert.equal(JSON.parse(line).route, "unknown");
    assert.doesNotMatch(line, /SECRET|PRIVATE_|https|private\.example/);
    assert.ok(line.length < 512);
  }
});

test("known route-file templates retain useful grouping without dynamic values", () => {
  for (const [input, expected] of [
    ["/[locale]/(shop)/catalog/page", "/[locale]/catalog"],
    ["/[locale]/shop/[token]/page", "/[locale]/shop/[token]"],
    ["/[locale]/admin/orders/[id]/documents/[type]/route", "/[locale]/admin/orders/[id]/documents/[type]"],
  ]) {
    logServerDiagnostic("server_request_unexpected", input);
    assert.equal(JSON.parse(output.at(-1)!).route, expected);
  }
});

test("unexpected hook failures emit one event without serializing request or raw error contents", () => {
  const failure = new Error("SECRET customer@example.test +972500000000 PDF_AMOUNT=123");
  Object.defineProperty(failure, "toJSON", { value() { throw new Error("must not serialize error"); } });
  Object.assign(failure, { password: "SECRET", fcmToken: "SECRET", details: request, digest: "PRIVATE_DIGEST" });
  const unreadableRequest = new Proxy(request, { get() { throw new Error("must not read request"); } });
  onRequestError(failure, unreadableRequest, context());
  assert.equal(output.length, 1);
  assert.equal(JSON.parse(output[0]).route, "/[locale]/shop/[token]");
  assert.doesNotMatch(output[0], /SECRET|PRIVATE_|customer@|97250|PDF_AMOUNT|password|fcmToken|authorization|cookie/);
});

test("hook never passes an actual path from unknown context into logs", () => {
  onRequestError(new Error("SECRET"), request, context(request.path));
  assert.equal(JSON.parse(output[0]).route, "unknown");
  assert.doesNotMatch(output[0], /SECRET|PRIVATE_TOKEN/);
});

test("repeated reports of the same exception are not amplified; distinct exceptions still report", () => {
  const failure = new Error("SECRET");
  onRequestError(failure, request, context());
  onRequestError(failure, request, context());
  onRequestError(new Error("SECRET"), request, context());
  assert.equal(output.length, 2);
});

test("unexpected primitive exceptions produce a fixed event without serializing the value", () => {
  onRequestError("SECRET", request, context());
  assert.equal(output.length, 1);
  assert.doesNotMatch(output[0], /SECRET/);
});

test("actual Next redirect, permanent redirect, not-found and wrapped control flow are not outages", () => {
  for (const control of [() => redirect("/ar/shop/PRIVATE_TOKEN"), () => permanentRedirect("/he"), () => notFound()]) {
    let failure: unknown;
    try { control(); } catch (error) { failure = error; }
    assert.ok(failure);
    assert.doesNotThrow(() => onRequestError(failure, request, context()));
    assert.doesNotThrow(() => onRequestError(new Error("wrapped", { cause: failure }), request, context()));
  }
  assert.equal(output.length, 0);
});

test("diagnostic sink failures never escape or trigger fallback/retry logging", () => {
  const errorSink = mock.method(console, "error", () => { throw new Error("sink unavailable SECRET"); });
  const warnSink = mock.method(console, "warn", () => { throw new Error("sink unavailable SECRET"); });
  assert.doesNotThrow(() => logServerDiagnostic("document_record_unavailable"));
  const failure = new Error("SECRET");
  assert.doesNotThrow(() => onRequestError(failure, request, context()));
  onRequestError(failure, request, context());
  assert.equal(errorSink.mock.callCount(), 1);
  assert.equal(warnSink.mock.callCount(), 1);
});

test("malformed metadata cannot make the instrumentation observer throw", () => {
  const failure = Object.defineProperty({}, "digest", { get() { throw new Error("SECRET"); } });
  assert.doesNotThrow(() => onRequestError(failure, request, context()));
  const badContext = new Proxy(context(), { get() { throw new Error("SECRET"); } });
  assert.doesNotThrow(() => onRequestError(new Error("SECRET"), request, badContext));
  assert.equal(output.length, 0);
});
