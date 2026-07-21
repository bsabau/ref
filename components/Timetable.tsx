"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PerformanceRow } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

const STAGE_ORDER = ["Adrian Rugina Stage", "Brasov Stage", "Andrei Calmuc Stage"];
const STAGE_COLOR: Record<string, string> = {
  "Adrian Rugina Stage": "green",
  "Brasov Stage": "purple",
  "Andrei Calmuc Stage": "orange",
};

const fmtTime = (iso: string) => iso.slice(11, 16);

interface Clash {
  withBand: string;
  from: string;
  to: string;
}

export default function Timetable({
  user,
  rows,
  initialFavs,
}: {
  user: SessionUser;
  rows: PerformanceRow[];
  initialFavs: number[];
}) {
  const router = useRouter();
  const days = useMemo(() => {
    const seen = new Map<number, PerformanceRow>();
    for (const r of rows) if (!seen.has(r.day_number)) seen.set(r.day_number, r);
    return [...seen.values()]
      .sort((a, b) => a.day_number - b.day_number)
      .map((r) => ({
        num: r.day_number,
        dow: r.day_of_week.slice(0, 3),
        date: r.day_date.slice(8, 10) + " Jul",
      }));
  }, [rows]);

  const todayDefault = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const match = rows.find((r) => r.day_date === today);
    return match ? match.day_number : 1;
  }, [rows]);

  const [view, setView] = useState<"festival" | "mine">("festival");
  const [day, setDay] = useState(todayDefault);
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<Set<number>>(new Set(initialFavs));

  async function toggleFav(id: number) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceId: id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setFavs((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const query = q.trim().toLowerCase();
  const matches = (r: PerformanceRow) =>
    !query ||
    r.band_name.toLowerCase().includes(query) ||
    r.artist_name.toLowerCase().includes(query) ||
    r.genres.some((g) => g.toLowerCase().includes(query));

  const favRows = useMemo(
    () => rows.filter((r) => favs.has(r.id)),
    [rows, favs]
  );

  const clashes = useMemo(() => {
    const map = new Map<number, Clash[]>();
    for (let i = 0; i < favRows.length; i++) {
      for (let j = i + 1; j < favRows.length; j++) {
        const a = favRows[i];
        const b = favRows[j];
        if (a.starts_at < b.ends_at && b.starts_at < a.ends_at) {
          const from = a.starts_at > b.starts_at ? a.starts_at : b.starts_at;
          const to = a.ends_at < b.ends_at ? a.ends_at : b.ends_at;
          const push = (id: number, withBand: string) => {
            if (!map.has(id)) map.set(id, []);
            map.get(id)!.push({ withBand, from: fmtTime(from), to: fmtTime(to) });
          };
          push(a.id, b.band_name);
          push(b.id, a.band_name);
        }
      }
    }
    return map;
  }, [favRows]);

  function Card({ r, showStage }: { r: PerformanceRow; showStage?: boolean }) {
    const color = STAGE_COLOR[r.stage] ?? "purple";
    const myClashes = view === "mine" ? clashes.get(r.id) : undefined;
    return (
      <Link
        href={`/band/${r.slug}`}
        className={`card stage-${color} ${r.is_headliner ? "headliner" : ""}`}
      >
        <div className="time">
          {fmtTime(r.starts_at)} – {fmtTime(r.ends_at)}
        </div>
        <div className="name">{r.band_name}</div>
        <div className="meta">
          {showStage && (
            <span className={`chip stagechip-${color}`}>
              {r.stage.replace(" Stage", "")}
            </span>
          )}
          {r.genres.slice(0, 3).map((g) => (
            <span key={g} className="chip">
              {g}
            </span>
          ))}
          {myClashes?.map((c) => (
            <span key={c.withBand} className="clash-badge">
              ⚠ clash: {c.withBand} {c.from}–{c.to}
            </span>
          ))}
        </div>
        <button
          className={`star-btn ${favs.has(r.id) ? "on" : ""}`}
          aria-label={favs.has(r.id) ? "Remove from my list" : "Add to my list"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(r.id);
          }}
        >
          {favs.has(r.id) ? "★" : "☆"}
        </button>
      </Link>
    );
  }

  const dayRows = rows.filter((r) => r.day_number === day && matches(r));
  const mineFiltered = favRows
    .filter(matches)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="shell wide">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            Rockstadt Extreme Fest
            <small>27–31 July 2026 · Ghimbav</small>
          </div>
          <div className="userchip">
            <span>{user.name}</span>
            <button onClick={logout}>Log out</button>
          </div>
        </div>
        <div className="controls" style={{ maxWidth: 640, margin: "8px auto 0" }}>
          <div className="switch">
            <button
              className={view === "festival" ? "active" : ""}
              onClick={() => setView("festival")}
            >
              Festival
            </button>
            <button
              className={view === "mine" ? "active" : ""}
              onClick={() => setView("mine")}
            >
              My list {favs.size > 0 && `(${favs.size})`}
            </button>
          </div>
          <input
            className="searchbox"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search band or genre…"
            type="search"
          />
          {view === "festival" && (
            <div className="tabs">
              {days.map((d) => (
                <button
                  key={d.num}
                  className={day === d.num ? "active" : ""}
                  onClick={() => setDay(d.num)}
                >
                  {d.dow}
                  <span>{d.date}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {view === "festival" ? (
        <main className="day-layout cols">
          {STAGE_ORDER.map((stage) => {
            const stageRows = dayRows.filter((r) => r.stage === stage);
            if (stageRows.length === 0 && query) return null;
            return (
              <section key={stage} className={`stage-${STAGE_COLOR[stage]}`}>
                <div className="stage-head">{stage}</div>
                <div className="cardlist">
                  {stageRows.length === 0 ? (
                    <div className="empty">No bands</div>
                  ) : (
                    stageRows.map((r) => <Card key={r.id} r={r} />)
                  )}
                </div>
              </section>
            );
          })}
          {query && dayRows.length === 0 && (
            <div className="empty">Nothing on this day matches “{q}”.</div>
          )}
        </main>
      ) : (
        <main>
          {mineFiltered.length === 0 ? (
            <div className="empty">
              {favs.size === 0
                ? "Your list is empty. Star some bands in the festival view!"
                : `Nothing in your list matches “${q}”.`}
            </div>
          ) : (
            days.map((d) => {
              const dayFavs = mineFiltered.filter((r) => r.day_number === d.num);
              if (dayFavs.length === 0) return null;
              return (
                <section key={d.num}>
                  <h2 className="day-heading">
                    Day {d.num} · {d.dow} {d.date}
                  </h2>
                  <div className="cardlist">
                    {dayFavs.map((r) => (
                      <Card key={r.id} r={r} showStage />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </main>
      )}
    </div>
  );
}
