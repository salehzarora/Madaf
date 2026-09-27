"use client";

import { useEffect } from "react";

/** Registers the document-failure fallback; never wraps or owns application UI. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(() => {
      // Storage/browser restrictions must not prevent normal online use.
      // A subsequent page load will retry registration.
    });
  }, []);

  return null;
}
