"use client";

import { useEffect } from "react";
import { flushPendingFavorites } from "@/lib/pendingFavorites";

// Registers the service worker on every page load (not only when the push
// toggle is used) and replays favorites queued while offline.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    flushPendingFavorites();
    const onOnline = () => flushPendingFavorites();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return null;
}
