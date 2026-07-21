"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type State = "unsupported" | "needs-install" | "off" | "on" | "busy" | "denied";

export default function PushToggle() {
  const [state, setState] = useState<State>("busy");
  const [hint, setHint] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // iOS Safari only exposes the Push API once the site is installed
        // to the home screen — show the switch and explain instead of hiding.
        setState(isStandalone() ? "unsupported" : "needs-install");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function toggle() {
    if (state === "needs-install") {
      setHint(true);
      return;
    }
    if (state !== "on" && state !== "off") return;
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      if (existing) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setState("off");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error();
      setState("on");
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported") return null;

  const title =
    state === "on"
      ? "Push notifications on — tap to disable"
      : state === "denied"
      ? "Notifications blocked in browser settings"
      : state === "needs-install"
      ? "Install the app to enable notifications"
      : "Enable push notifications (15 min before your starred bands)";

  return (
    <>
      <button
        onClick={toggle}
        title={title}
        aria-label={title}
        role="switch"
        aria-checked={state === "on"}
        disabled={state === "busy" || state === "denied"}
        className={`push-switch ${state === "on" ? "on" : ""}`}
      >
        {state === "on" ? "ON" : "OFF"}
      </button>
      {hint && (
        <div className="install-hint" role="dialog" aria-label="How to install">
          <strong>Install the app to get notifications</strong>
          <ol>
            <li>Open this site in Safari</li>
            <li>
              Tap the <span aria-hidden>⎋</span> Share button
            </li>
            <li>Choose “Add to Home Screen”, then Add</li>
            <li>Open REF from your home screen and turn this switch on</li>
          </ol>
          <button className="btn" onClick={() => setHint(false)}>
            Got it
          </button>
        </div>
      )}
    </>
  );
}
