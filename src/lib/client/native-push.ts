import { FCM_TOKEN, UUID } from "@/lib/push/device-input";
import type { Locale } from "@/i18n/config";

type NativeChannel = { postMessage(message: string): void; onmessage?: (event: { data: string }) => void };
type NativeWindow = Window & { MadafNative?: NativeChannel };
export const PUSH_LOGOUT_EVENT = "madaf-native-push-logout";
export const PUSH_RESUME_EVENT = "madaf-native-push-resume";

/** Invisible sync. No token in localStorage/cookies/DOM/logs; only the random,
 * non-authoritative installation UUID persists. Ordinary browsers do nothing. */
export function startNativePushSync(win: NativeWindow, locale: Locale): () => void {
  const bridge = win.MadafNative;
  if (!bridge || typeof bridge.postMessage !== "function") return () => {};
  let installationId: string;
  try {
    const saved = win.localStorage.getItem("madaf.native.installation.v1");
    installationId = saved && UUID.test(saved) ? saved : win.crypto.randomUUID();
    win.localStorage.setItem("madaf.native.installation.v1", installationId);
  } catch { return () => {}; } // No unstable identity when storage is unavailable.
  let stopped = false;
  let paused = false;
  let busy = false;
  let known: { scope: string; token: string } | null = null;
  let nextAttempt = 0;
  let failures = 0;
  const waiting = new Map<string, { type: string; resolve(v: Record<string, unknown>): void; reject(): void }>();
  const requests = new Set<AbortController>();
  const previous = bridge.onmessage;
  const onmessage = (event: { data: string }) => {
    try {
      const value = JSON.parse(event.data);
      const entry = waiting.get(value?.id);
      if (entry && value.type === entry.type && value.result && typeof value.result === "object") {
        entry.resolve(value.result); return;
      }
    } catch { /* Ignore unrelated/malformed messages, never log bridge payloads. */ }
    previous?.(event);
  };
  bridge.onmessage = onmessage;
  const native = (type: string): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const id = `push_${win.crypto.randomUUID()}`;
    const finish = () => { win.clearTimeout(timer); waiting.delete(id); };
    const timer = win.setTimeout(() => { waiting.delete(id); reject(new Error("native_timeout")); }, 5000);
    waiting.set(id, { type, resolve: value => { finish(); resolve(value); },
      reject: () => { finish(); reject(new Error("native_cancelled")); } });
    try { bridge.postMessage(JSON.stringify({ id, type })); }
    catch { waiting.get(id)?.reject(); }
  });
  const api = async (init?: RequestInit) => {
    const controller = new AbortController(); requests.add(controller);
    const timer = win.setTimeout(() => controller.abort(), 8000);
    try { return await win.fetch("/api/mobile/devices", { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal }); }
    finally { win.clearTimeout(timer); requests.delete(controller); }
  };
  const tick = async () => {
    if (stopped || paused || busy || Date.now() < nextAttempt) return;
    busy = true;
    try {
      const session = await api();
      if (session.status === 401) { known = null; return; }
      if (!session.ok) throw new Error("session_unavailable");
      const { scope } = await session.json();
      if (typeof scope !== "string") return;
      const capabilities = await native("getCapabilities");
      const push = capabilities.push as { configured?: boolean } | undefined;
      if (capabilities.platform !== "android" || !push?.configured) return;
      const registration = await native("getPushRegistration");
      const token = registration.token;
      if (registration.status !== "registered" || typeof token !== "string" || !FCM_TOKEN.test(token)) return;
      if (stopped || paused || (known?.scope === scope && known.token === token)) return;
      const result = await api({ method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, token, locale, platform: "android", enabled: true }) });
      if (!result.ok) throw new Error("registration_unavailable");
      if (!stopped && !paused) known = { scope, token };
      failures = 0; nextAttempt = 0;
    } catch {
      // Bounded backoff; foreground/periodic checks recover without a render loop.
      nextAttempt = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures++, 6));
    } finally { busy = false; }
  };
  const cancelRequests = () => { requests.forEach(request => request.abort()); waiting.forEach(entry => entry.reject()); };
  const pause = () => { paused = true; known = null; cancelRequests(); };
  const resume = () => { paused = false; nextAttempt = 0; void tick(); };
  const foreground = () => { if (win.document.visibilityState === "visible") void tick(); };
  win.addEventListener(PUSH_LOGOUT_EVENT, pause);
  win.addEventListener(PUSH_RESUME_EVENT, resume);
  win.addEventListener("focus", foreground);
  win.document.addEventListener("visibilitychange", foreground);
  const interval = win.setInterval(() => { void tick(); }, 30_000);
  void tick();
  return () => {
    stopped = true; known = null; cancelRequests(); win.clearInterval(interval);
    win.removeEventListener(PUSH_LOGOUT_EVENT, pause);
    win.removeEventListener(PUSH_RESUME_EVENT, resume);
    win.removeEventListener("focus", foreground);
    win.document.removeEventListener("visibilitychange", foreground);
    if (bridge.onmessage === onmessage) bridge.onmessage = previous;
  };
}
