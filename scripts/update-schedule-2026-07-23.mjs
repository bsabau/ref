#!/usr/bin/env node
// One-off update for the revised timetable published 2026-07-23:
// Crowbar + Conservative Military Image cancelled, nine bands moved.
// Idempotent: moves re-apply the same values, deletes match nothing on re-run.
// Usage: node scripts/update-schedule-2026-07-23.mjs
//   DATABASE_URL from env, or from .env.local at the repo root / $ENV_FILE.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    process.env.ENV_FILE,
    resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"),
  ].filter(Boolean);
  for (const file of candidates) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const line = text.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) {
      return line
        .slice("DATABASE_URL=".length)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  throw new Error(
    "DATABASE_URL not set; export it or point ENV_FILE at a file containing it"
  );
}

const sql = neon(loadDatabaseUrl());

// slug, day_number, day_date, day_of_week, stage, start, end
const MOVES = [
  ["groza", 1, "2026-07-27", "Monday", "Adrian Rugina Stage", "17:30", "18:15"],
  ["necrotted", 1, "2026-07-27", "Monday", "Andrei Calmuc Stage", "16:25", "17:10"],
  ["vader", 2, "2026-07-28", "Tuesday", "Andrei Calmuc Stage", "22:00", "23:00"],
  ["annisokay", 3, "2026-07-29", "Wednesday", "Adrian Rugina Stage", "15:50", "16:35"],
  ["allt", 3, "2026-07-29", "Wednesday", "Brasov Stage", "15:00", "15:45"],
  ["immolation", 3, "2026-07-29", "Wednesday", "Brasov Stage", "16:40", "17:30"],
  ["underwaves", 3, "2026-07-29", "Wednesday", "Andrei Calmuc Stage", "16:25", "17:10"],
  ["machukha", 4, "2026-07-30", "Thursday", "Andrei Calmuc Stage", "16:00", "16:45"],
  ["slow-crush", 4, "2026-07-30", "Thursday", "Andrei Calmuc Stage", "17:15", "18:00"],
];

const CANCELLED = ["crowbar", "conservative-military-image"];

const stageRows = await sql`SELECT id, name FROM stages`;
const stageId = Object.fromEntries(stageRows.map((r) => [r.name, r.id]));
for (const [, , , , stage] of MOVES) {
  if (!stageId[stage]) throw new Error(`Stage not found in DB: ${stage}`);
}

// Pre-flight: every moved band must have exactly one performance row.
const movedSlugs = MOVES.map((m) => m[0]);
const existing = await sql`
  SELECT a.slug, count(p.id)::int AS n
  FROM artists a LEFT JOIN performances p ON p.artist_id = a.id
  WHERE a.slug = ANY(${movedSlugs})
  GROUP BY a.slug`;
const bySlug = Object.fromEntries(existing.map((r) => [r.slug, r.n]));
for (const slug of movedSlugs) {
  if (bySlug[slug] !== 1) {
    throw new Error(
      `Expected exactly 1 performance for "${slug}", found ${bySlug[slug] ?? 0} — aborting, nothing changed`
    );
  }
}

const queries = MOVES.map(
  ([slug, dayNum, date, dow, stage, start, end]) => sql`
    UPDATE performances p SET
      day_number = ${dayNum},
      day_date = ${date},
      day_of_week = ${dow},
      stage_id = ${stageId[stage]},
      starts_at = ${`${date}T${start}:00`},
      ends_at = ${`${date}T${end}:00`}
    FROM artists a
    WHERE a.id = p.artist_id AND a.slug = ${slug}
    RETURNING a.slug`
);
queries.push(
  sql`DELETE FROM notifications_sent WHERE performance_id IN
        (SELECT p.id FROM performances p JOIN artists a ON a.id = p.artist_id
         WHERE a.slug = ANY(${CANCELLED}))
      RETURNING performance_id`,
  sql`DELETE FROM favorites WHERE performance_id IN
        (SELECT p.id FROM performances p JOIN artists a ON a.id = p.artist_id
         WHERE a.slug = ANY(${CANCELLED}))
      RETURNING user_id`,
  sql`DELETE FROM performances WHERE artist_id IN
        (SELECT id FROM artists WHERE slug = ANY(${CANCELLED}))
      RETURNING band_name`
);

const results = await sql.transaction(queries);

const moveResults = results.slice(0, MOVES.length);
const [delNotifs, delFavs, delPerfs] = results.slice(MOVES.length);
console.log("Moved:", moveResults.flat().map((r) => r.slug).join(", "));
console.log(
  `Cancelled: ${delPerfs.map((r) => r.band_name).join(", ") || "(already removed)"}` +
    ` — removed ${delFavs.length} favorite(s), ${delNotifs.length} sent-notification record(s)`
);

// Post-run report: full timetable + orphan checks.
const timetable = await sql`
  SELECT p.day_number, p.day_of_week, s.name AS stage, p.band_name,
         to_char(p.starts_at, 'HH24:MI') AS starts,
         to_char(p.ends_at, 'HH24:MI') AS ends
  FROM performances p JOIN stages s ON s.id = p.stage_id
  ORDER BY p.day_number, p.starts_at, s.name`;
let day = 0;
for (const r of timetable) {
  if (r.day_number !== day) {
    day = r.day_number;
    console.log(`\n== Day ${day} (${r.day_of_week}) ==`);
  }
  console.log(`  ${r.starts}-${r.ends}  ${r.stage.padEnd(20)} ${r.band_name}`);
}

const [{ n: orphanFavs }] = await sql`
  SELECT count(*)::int AS n FROM favorites f
  LEFT JOIN performances p ON p.id = f.performance_id WHERE p.id IS NULL`;
const [{ n: orphanNotifs }] = await sql`
  SELECT count(*)::int AS n FROM notifications_sent x
  LEFT JOIN performances p ON p.id = x.performance_id WHERE p.id IS NULL`;
console.log(`\nOrphan favorites: ${orphanFavs}, orphan notifications_sent: ${orphanNotifs}`);
console.log(`Total performances: ${timetable.length}`);
