import { dom } from "@/test-support/jsdom-env";
globalThis.FormData = dom.window.FormData;
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getDictionary } from "@/i18n/dictionaries";
import { defaultPushPreferences } from "@/lib/push/preferences";
let saveResult = true, saveThrows = false;
let pendingSave: ((value: { ok: boolean }) => void) | undefined;
let defer = false;
const saved: unknown[] = [];
mock.module("@/lib/actions/push-preferences", { namedExports: { savePushPreferencesAction: async (input: unknown) => {
  saved.push(input); if (saveThrows) throw new Error("transport");
  if (defer) return new Promise<{ ok: boolean }>(resolve => { pendingSave = resolve; });
  return { ok: saveResult };
} } });
const { NotificationSettings } = await import("./notification-settings");
for (const locale of ["ar", "he", "en"] as const) {
  test(`${locale}: four accessible switches, defaults, saving/saved/error and retry`, async () => {
    saved.length = 0; saveResult = true; saveThrows = false; defer = false;
    const text = getDictionary(locale).notificationSettings;
    const container = document.createElement("div"); container.dir = locale === "en" ? "ltr" : "rtl"; document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(NotificationSettings, { initial: defaultPushPreferences, text, live: true, scope: "scope-A" })));
    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    assert.equal(switches.length, 4);
    assert.deepEqual(switches.map(s => s.getAttribute("aria-checked")), ["true", "true", "true", "false"]);
    for (const control of switches) { assert.ok(control.getAttribute("aria-label")); assert.ok(document.getElementById(control.getAttribute("aria-describedby")!)); }
    await act(async () => switches[0].click());
    assert.equal(switches[0].getAttribute("aria-checked"), "false");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    defer = true;
    await act(async () => submit.click());
    assert.equal(submit.textContent, text.saving); assert.ok(submit.disabled); assert.ok(switches.every(s => s.disabled));
    assert.deepEqual(saved[0], { ...defaultPushPreferences, new_order: false });
    await act(async () => pendingSave!({ ok: true }));
    assert.equal(container.querySelector('[role="status"]')?.textContent, text.saved);
    defer = false; saveResult = false;
    await act(async () => switches[3].click());
    assert.equal(container.querySelector('[role="status"]')?.textContent, "");
    await act(async () => submit.click());
    assert.equal(container.querySelector('[role="alert"]')?.textContent, text.error);
    saveResult = true;
    await act(async () => submit.click()); assert.equal(container.querySelector('[role="status"]')?.textContent, text.saved);
    saveThrows = true;
    await act(async () => submit.click()); assert.equal(container.querySelector('[role="alert"]')?.textContent, text.error);
    assert.doesNotMatch(container.textContent ?? "", /fcm|token|device.id/i);
    await act(async () => root.unmount()); container.remove();
  });
}
test("mock preview cannot pretend to persist preferences", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  const text = getDictionary("en").notificationSettings;
  await act(async () => root.render(React.createElement(NotificationSettings, { initial: defaultPushPreferences, text, live: false, scope: "mock" })));
  assert.ok(container.textContent?.includes(text.demo));
  assert.ok([...container.querySelectorAll<HTMLButtonElement>("button")].every(b => b.disabled));
  await act(async () => root.unmount());
});

test("server scope key resets unsaved values and saved status on supplier switch", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  const text = getDictionary("en").notificationSettings;
  await act(async () => root.render(React.createElement(NotificationSettings, { key: "A", scope: "A", initial: defaultPushPreferences, text, live: true })));
  await act(async () => container.querySelector<HTMLButtonElement>("[role=switch]")!.click());
  assert.equal(container.querySelector("[role=switch]")!.getAttribute("aria-checked"), "false");
  await act(async () => root.render(React.createElement(NotificationSettings, { key: "B", scope: "B", initial: { new_order: true, signup_request: false, low_stock: false, order_status: true }, text, live: true })));
  assert.deepEqual([...container.querySelectorAll("[role=switch]")].map(s => s.getAttribute("aria-checked")), ["true", "false", "false", "true"]);
  assert.equal(container.querySelector("[role=status]")?.textContent, "");
  await act(async () => root.unmount());
});
