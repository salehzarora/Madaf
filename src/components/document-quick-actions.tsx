"use client";

import { Download, Printer, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import type { DocumentType } from "@/lib/types";
import { connectNativeDocuments, type DocumentAction } from "@/lib/client/native-documents";

const actionClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-field px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export function DocumentQuickActions({ locale, orderId, type, labels }: {
  locale: Locale;
  orderId: string;
  type: DocumentType;
  labels: Dictionary["docs"]["quickActions"];
}) {
  const base = `/${locale}/admin/orders/${encodeURIComponent(orderId)}/documents/${type}`;
  return <DocumentActionsForRoute key={base} base={base} labels={labels} />;
}

function DocumentActionsForRoute({ base, labels }: {
  base: string;
  labels: Dictionary["docs"]["quickActions"];
}) {
  const shareUrl = `${base}?mode=share`;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"fallback" | "error" | "ready" | "nativeError" | null>(null);
  const native = useRef<ReturnType<typeof connectNativeDocuments>>(null);
  const nativeBusy = useRef(false);
  const pending = useRef<AbortController | null>(null);
  // A short-lived in-memory retry is only for browsers that lose transient
  // activation during PDF preparation. Never persist the file or an admin URL.
  const ready = useRef<{ file: File; expires: number } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const connection = connectNativeDocuments(window);
    native.current = connection;
    return () => { native.current = null; connection?.dispose(); };
  }, []);
  useEffect(() => () => {
    pending.current?.abort();
    ready.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
  }, [base]);

  function openInline() {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
    // Keep a real link available even when a popup blocker prevents window.open.
    setNotice("fallback");
  }

  async function nativeAction(type: DocumentAction): Promise<boolean> {
    const connection = native.current;
    if (!connection) return false;
    if (nativeBusy.current || pending.current) return true;
    nativeBusy.current = true;
    setBusy(true); setNotice(null);
    try {
      const capabilities = await connection.capabilities;
      if (native.current !== connection) return true;
      if (!(type === "shareDocumentPdf" ? capabilities.share : capabilities.print)) return false;
      await connection.run(type, shareUrl);
    } catch (error) {
      if (native.current === connection && !(error instanceof Error && error.name === "AbortError")) setNotice("nativeError");
    } finally {
      nativeBusy.current = false;
      if (native.current === connection) setBusy(false);
    }
    return true;
  }

  async function share() {
    if (pending.current || nativeBusy.current) return;
    if (native.current && await nativeAction("shareDocumentPdf")) return;
    setNotice(null);
    if (typeof navigator.share !== "function") {
      openInline();
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    let file: File | undefined;
    try {
      if (ready.current && ready.current.expires > Date.now()) {
        file = ready.current.file;
      } else {
        const response = await fetch(shareUrl, {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/pdf") {
          throw new Error("pdf-unavailable");
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("pdf-unavailable");
        const name = response.headers.get("Content-Disposition")?.match(/filename="([a-zA-Z0-9_-]+\.pdf)"/)?.[1] ?? "document.pdf";
        file = new File([blob], name, { type: "application/pdf" });
      }
      ready.current = null;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      if (controller.signal.aborted) return;
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        openInline();
        return;
      }
      // No URL/text payload: the customer receives the PDF file itself.
      await navigator.share({ files: [file] });
    } catch (error) {
      if (controller.signal.aborted) return;
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError") return; // Native sheet cancellation is normal.
      if (name === "NotAllowedError" && file) {
        ready.current = { file, expires: Date.now() + 60_000 };
        expiryTimer.current = setTimeout(() => { ready.current = null; }, 60_000);
        setNotice("ready");
      } else {
        ready.current = null;
        setNotice("error");
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={share} disabled={busy} aria-busy={busy}
          className={`${actionClass} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50`}>
          <Share2 className="size-4 shrink-0" aria-hidden />
          {busy ? labels.preparing : labels.share}
        </button>
        <a href={`${base}/print`} target="_blank" rel="noopener noreferrer"
          onClick={event => {
            if (!native.current) return; // Ordinary browser link/navigation stays untouched.
            event.preventDefault();
            void nativeAction("printDocumentPdf").then(handled => {
              if (!handled) window.open(`${base}/print`, "_blank", "noopener,noreferrer");
            });
          }}
          className={`${actionClass} border border-line text-ink-soft hover:bg-surface-sunken`}>
          <Printer className="size-4 shrink-0" aria-hidden />{labels.print}
        </a>
        <a href={base} className={`${actionClass} border border-line text-ink-soft hover:bg-surface-sunken`}>
          <Download className="size-4 shrink-0" aria-hidden />{labels.download}
        </a>
      </div>
      <div role="status" aria-live="polite" className="text-xs leading-relaxed text-ink-soft">
        {notice ? <p className="mt-2">
          {notice === "nativeError" ? labels.nativeError : notice === "ready" ? labels.ready : notice === "error" ? labels.error : labels.fallback}{" "}
          <a href={shareUrl} target="_blank" rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-600">
            {labels.openPdf}
          </a>
        </p> : null}
      </div>
    </div>
  );
}
