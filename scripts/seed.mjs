#!/usr/bin/env node
// Create the database schema and seed stages, artists, and performances from
// artists.json and lineup.json. Idempotent: safe to re-run against an existing
// database without losing users, favorites, or push subscriptions.
// Usage: node scripts/seed.mjs
//   DATABASE_URL from env, or from .env.local at the repo root / $ENV_FILE.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [process.env.ENV_FILE, resolve(ROOT, ".env.local")].filter(
    Boolean
  );
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

const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

function addOneDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toTimestamp(dayDate, hhmm) {
  const hour = Number(hhmm.slice(0, 2));
  const date = hour < 12 ? addOneDay(dayDate) : dayDate;
  return `${date}T${hhmm}:00`;
}

const sql = neon(loadDatabaseUrl());

const artists = JSON.parse(readFileSync(resolve(ROOT, "artists.json"), "utf8"));
const lineup = JSON.parse(readFileSync(resolve(ROOT, "lineup.json"), "utf8"));

await sql`
  CREATE TABLE IF NOT EXISTS stages (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS artists (
    id serial PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    lineup_name text,
    country text,
    genres text[] NOT NULL DEFAULT '{}',
    bio text,
    source_url text,
    festival_url text,
    socials text[] NOT NULL DEFAULT '{}',
    local_image text NOT NULL
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS performances (
    id serial PRIMARY KEY,
    day_number integer NOT NULL,
    day_date date NOT NULL,
    day_of_week text NOT NULL,
    stage_id integer NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    artist_id integer NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    band_name text NOT NULL,
    starts_at timestamp NOT NULL,
    ends_at timestamp NOT NULL,
    is_headliner boolean NOT NULL DEFAULT false,
    UNIQUE (artist_id, day_number)
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS favorites (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performance_id integer NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, performance_id)
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS notifications_sent (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performance_id integer NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
    sent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, performance_id)
  )`;

await sql`
  CREATE TABLE IF NOT EXISTS artist_setlists (
    artist_id integer PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
    matched_name text NOT NULL,
    setlist_url text NOT NULL,
    event_date date NOT NULL,
    venue text,
    tour text,
    songs jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
  )`;

const stageIds = new Map();
for (const stageName of lineup.festival.stages) {
  const [row] = await sql`
    INSERT INTO stages (name) VALUES (${stageName})
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name`;
  stageIds.set(row.name, row.id);
}

const artistByName = new Map();
for (const a of artists) {
  const [row] = await sql`
    INSERT INTO artists (
      slug, name, lineup_name, country, genres, bio,
      source_url, festival_url, socials, local_image
    ) VALUES (
      ${a.slug}, ${a.name}, ${a.lineupName ?? null}, ${a.country ?? null},
      ${a.genres ?? []}, ${a.bio ?? null}, ${a.source ?? null},
      ${a.url ?? null}, ${a.socials ?? []}, ${a.localImage}
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      lineup_name = EXCLUDED.lineup_name,
      country = EXCLUDED.country,
      genres = EXCLUDED.genres,
      bio = EXCLUDED.bio,
      source_url = EXCLUDED.source_url,
      festival_url = EXCLUDED.festival_url,
      socials = EXCLUDED.socials,
      local_image = EXCLUDED.local_image
    RETURNING id, slug, name, lineup_name`;
  artistByName.set(normalize(row.name), row.id);
  if (row.lineup_name) artistByName.set(normalize(row.lineup_name), row.id);
}

let perfCount = 0;
for (const d of lineup.days) {
  for (const s of d.stages) {
    const stageId = stageIds.get(s.stage);
    for (const b of s.bands) {
      const artistId = artistByName.get(normalize(b.name));
      if (!artistId) {
        throw new Error(`No artist found in artists.json for "${b.name}"`);
      }
      const startsAt = toTimestamp(d.date, b.start);
      const endsAt = toTimestamp(d.date, b.end);
      const existing = await sql`
        SELECT id FROM performances WHERE artist_id = ${artistId}`;
      if (existing.length > 0) {
        await sql`
          UPDATE performances SET
            day_number = ${d.day},
            day_date = ${d.date},
            day_of_week = ${d.dayOfWeek},
            stage_id = ${stageId},
            band_name = ${b.name},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            is_headliner = ${Boolean(b.headliner)}
          WHERE id = ${existing[0].id}`;
      } else {
        await sql`
          INSERT INTO performances (
            day_number, day_date, day_of_week, stage_id, artist_id,
            band_name, starts_at, ends_at, is_headliner
          ) VALUES (
            ${d.day}, ${d.date}, ${d.dayOfWeek}, ${stageId}, ${artistId},
            ${b.name}, ${startsAt}, ${endsAt}, ${Boolean(b.headliner)}
          )`;
      }
      perfCount++;
    }
  }
}

console.log(
  `Seeded ${stageIds.size} stages, ${artists.length} artists, and ${perfCount} performances.`
);
