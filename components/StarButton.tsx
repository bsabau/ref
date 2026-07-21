"use client";

import { useState } from "react";

export default function StarButton({
  performanceId,
  initial,
}: {
  performanceId: number;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);

  async function toggle() {
    setOn((v) => !v);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setOn((v) => !v);
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
