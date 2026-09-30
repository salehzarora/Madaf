type ReplyEvent = { data: string };
type DocumentChannel = {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: ReplyEvent) => void): void;
  removeEventListener(type: "message", listener: (event: ReplyEvent) => void): void;
};
export type DocumentWindow = Window & { MadafNative?: DocumentChannel };
export type DocumentAction = "shareDocumentPdf" | "printDocumentPdf";

/** Separate listeners coexist with push's onmessage; never replace its handler. */
export function connectNativeDocuments(win: DocumentWindow) {
  const available = win.MadafNative;
  if (!available || typeof available.postMessage !== "function"
    || typeof available.addEventListener !== "function" || typeof available.removeEventListener !== "function") return null;
  const bridge: DocumentChannel = available;
  let stopped = false;
  const waiting = new Map<string, { type: string; finish(result?: Record<string, unknown>): void }>();
  const receive = (event: ReplyEvent) => {
    try {
      const message = JSON.parse(event.data);
      const entry = waiting.get(message?.id);
      if (entry && message.type === entry.type && message.result && typeof message.result === "object") {
        entry.finish(message.result);
      }
    } catch { /* Malformed/unrelated messages, including push replies, are ignored. */ }
  };
  bridge.addEventListener("message", receive);
  function request(type: string, path?: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (stopped) { reject(new DOMException("Cancelled", "AbortError")); return; }
      const id = `doc_${win.crypto.randomUUID()}`;
      const timer = win.setTimeout(() => finish(), type === "getCapabilities" ? 1500 : 60_000);
      function finish(result?: Record<string, unknown>) {
        win.clearTimeout(timer); waiting.delete(id);
        if (result) resolve(result);
        else reject(stopped ? new DOMException("Cancelled", "AbortError") : new Error("native_document_unavailable"));
      }
      waiting.set(id, { type, finish });
      try { bridge.postMessage(JSON.stringify({ id, type, ...(path ? { path } : {}) })); }
      catch { finish(); }
    });
  }
  const capabilities = request("getCapabilities").then(result => {
    const documents = result.documents as { sharePdf?: boolean; printPdf?: boolean } | undefined;
    return result.version === 1 && result.platform === "android" && result.shell === "webview"
      ? { share: documents?.sharePdf === true, print: documents?.printPdf === true }
      : { share: false, print: false };
  }).catch(() => ({ share: false, print: false }));
  return {
    capabilities,
    async run(type: DocumentAction, path: string) {
      // Native independently validates this path and authorizes with its existing session.
      if (!/^\/(ar|he|en)\/admin\/orders\/[A-Za-z0-9_-]{1,128}\/documents\/(order|delivery|invoiceDraft)\?mode=share$/.test(path)) {
        throw new Error("native_document_unavailable");
      }
      const result = await request(type, path);
      if (result.status === "cancelled") return;
      if (result.status !== "opened") throw new Error("native_document_unavailable");
    },
    dispose() {
      stopped = true;
      waiting.forEach(entry => entry.finish());
      bridge.removeEventListener("message", receive);
    },
  };
}
