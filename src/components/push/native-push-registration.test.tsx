import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { NativePushRegistration } from "./native-push-registration";
import type { startNativePushSync } from "@/lib/client/native-push";

test("mounted locale changes resync native registration with one installation and token", async () => {
  const win = window as Parameters<typeof startNativePushSync>[0];
  const posts: { locale: string; installationId: string; token: string }[] = [];
  win.fetch = async (_url, init) => {
    if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
    return Response.json(init?.method === "POST" ? { ok: true } : { scope: "same-authenticated-tenant-session" });
  };
  win.MadafNative = { postMessage(raw) {
    const { id, type } = JSON.parse(raw);
    const result = type === "getCapabilities" ? { platform: "android", push: { configured: true } }
      : { status: "registered", token: "synthetic_same_private_native_token_0001" };
    win.MadafNative!.onmessage?.({ data: JSON.stringify({ id, type, result }) });
  } };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    for (const locale of ["he", "ar", "en"] as const) {
      await act(async () => {
        root.render(<PathnameContext.Provider value={`/${locale}/admin`}><NativePushRegistration locale={locale} /></PathnameContext.Provider>);
      });
    }
    assert.deepEqual(posts.map(post => post.locale), ["he", "ar", "en"]);
    assert.equal(new Set(posts.map(post => post.installationId)).size, 1);
    assert.equal(new Set(posts.map(post => post.token)).size, 1);
    assert.equal(container.textContent, "");
  } finally {
    act(() => root.unmount()); container.remove(); delete win.MadafNative;
    dom.window.localStorage.clear();
  }
});
