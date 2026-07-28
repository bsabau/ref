// Client-side queue for favorite toggles made while offline. Each entry maps
// a performance id to the desired end state, so replaying is idempotent
// (the API accepts an explicit `favorited` flag, not just a toggle).

const KEY = "ref:pending-favorites";

type Pending = Record<string, boolean>;

function load(): Pending {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(pending: Pending) {
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // storage full or unavailable — the star simply won't survive a reload
  }
}

/** Remember a toggle that couldn't reach the server. */
export function queueFavorite(performanceId: number, favorited: boolean) {
  const pending = load();
  pending[String(performanceId)] = favorited;
  save(pending);
}

/** Overlay queued-but-unsynced toggles onto the server-rendered favorites. */
export function applyPendingFavorites(ids: Iterable<number>): Set<number> {
  const set = new Set(ids);
  const pending = load();
  for (const [id, fav] of Object.entries(pending)) {
    if (fav) set.add(Number(id));
    else set.delete(Number(id));
  }
  return set;
}

/** True if this performance has a queued state, and what it is. */
export function pendingStateFor(performanceId: number): boolean | undefined {
  return load()[String(performanceId)];
}

let flushing = false;

/** Try to sync every queued toggle; keeps entries that still fail. */
export async function flushPendingFavorites(): Promise<void> {
  if (flushing) return;
  const pending = load();
  const entries = Object.entries(pending);
  if (entries.length === 0) return;
  flushing = true;
  try {
    for (const [id, favorited] of entries) {
      try {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ performanceId: Number(id), favorited }),
        });
        // Synced, or permanently rejected (bad id, logged out) — either way
        // stop retrying; only network failures stay queued.
        if (res.ok || res.status === 400 || res.status === 401) {
          const current = load();
          delete current[id];
          save(current);
        }
      } catch {
        // still offline — leave it queued
      }
    }
  } finally {
    flushing = false;
  }
}
