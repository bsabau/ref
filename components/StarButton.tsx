"use client";

import { useEffect, useState } from "react";
import { pendingStateFor, queueFavorite } from "@/lib/pendingFavorites";

export default function StarButton({
  performanceId,
  initial,
}: {
  performanceId: number;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);

  // Reflect a toggle queued while offline (post-mount to keep hydration
  // consistent with the server-rendered markup).
  useEffect(() => {
    const pending = pendingStateFor(performanceId);
    if (pending !== undefined) setOn(pending);
  }, [performanceId]);

  async function toggle() {
    const desired = !on;
    setOn(desired);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceId, favorited: desired }),
      });
      if (!res.ok) throw new Error("rejected");
    } catch (err) {
      if (err instanceof TypeError) {
        // network failure (offline) — keep the star and sync when back online
        queueFavorite(performanceId, desired);
        return;
      }
      setOn(!desired);
    }
  }

  return (
    <button
      className={`star-btn ${on ? "on" : ""}`}
      aria-label={on ? "Remove from my list" : "Add to my list"}
      onClick={toggle}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
