"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(create: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), create }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 404 && data.unknown) {
        setUnknown(true);
      } else {
        setError(data.error ?? "Something went wrong, try again.");
      }
    } catch {
      setError("Network error, try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <h1 className="login-title">
        Rockstadt
        <br />
        Extreme Fest
        <em>Ghimbav &middot; 27–31 July 2026</em>
      </h1>

      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setUnknown(false);
            setError(null);
          }}
          placeholder="Your name"
          maxLength={30}
          disabled={busy}
        />

        {unknown ? (
          <>
            <div className="notice">
              No user named <strong>{name.trim()}</strong> yet. Create it?
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => submit(true)}
            >
              Create &amp; enter
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setUnknown(false)}
            >
              No, let me retype
            </button>
          </>
        ) : (
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            Enter the pit
          </button>
        )}

        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}
