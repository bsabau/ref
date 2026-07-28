#!/usr/bin/env node
// Fetch each artist's most recent past show (with songs) from setlist.fm and
// store it in the artist_setlists table for the band page.
// Uses the official API when SETLISTFM_API_KEY is set, otherwise politely
// scrapes the public pages allowed by setlist.fm's robots.txt (~1 req/1.2s).
// Idempotent: artists that already have a stored setlist are skipped.
// Usage: node scripts/fetch-setlists.mjs [--force] [--only=<slug>] [--limit=N]
//   DATABASE_URL from env, or from .env.local at the repo root / $ENV_FILE.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

function loadEnv(name) {
  if (process.env[name]) return process.env[name];
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
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) {
      return line
        .slice(name.length + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const databaseUrl = loadEnv("DATABASE_URL");
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL not set; export it or point ENV_FILE at a file containing it"
  );
}
const sql = neon(databaseUrl);
const apiKey = loadEnv("SETLISTFM_API_KEY");

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const limit = Number(
  args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? Infinity
);

const USER_AGENT =
  "ref-festival-app/1.0 (personal festival companion; bogdan.sabau@gmail.com)";
const DELAY_MS = 1200;
const today = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;
async function politeFetch(url, headers = {}) {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; ; attempt++) {
    lastRequest = Date.now();
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(3000);
      continue;
    }
    if (res.status === 429 && attempt < 2) {
      await sleep(30000);
      continue;
    }
    // AWS WAF bot challenge: empty 202 that only a JS-running browser can
    // pass. Back off hard once, then give up with a clear error.
    if (res.status === 202 && res.headers.get("x-amzn-waf-action")) {
      if (attempt < 1) {
        await sleep(60000);
        continue;
      }
      throw new Error(
        "blocked by setlist.fm bot protection — get a free API key at https://api.setlist.fm and set SETLISTFM_API_KEY"
      );
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(3000);
      continue;
    }
    return res;
  }
}

const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// ---------------------------------------------------------------- scrape path

async function scrapeArtistPageUrl(name) {
  const res = await politeFetch(
    `https://www.setlist.fm/search/artists?query=${encodeURIComponent(name)}`
  );
  if (!res.ok) throw new Error(`artist search HTTP ${res.status}`);
  const html = await res.text();
  const matches = [];
  const re = /href="\.\.\/(setlists\/[a-z0-9-]+\.html)" title="View (.+?) setlists"/g;
  for (let m; (m = re.exec(html)); ) {
    matches.push({ url: `https://www.setlist.fm/${m[1]}`, name: decodeEntities(m[2]) });
  }
  if (matches.length === 0) return null;
  const exact = matches.find((m) => normalize(m.name) === normalize(name));
  return exact ?? matches[0];
}

function parseDateBlock(html) {
  const m = html.match(
    /class="month">([A-Za-z]{3})<\/span>\s*<span class="day">(\d{1,2})<\/span>\s*<span class="year">(\d{4})<\/span>/
  );
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
}

function scrapeCandidates(artistHtml) {
  // Entries on the artist page, newest first: a dateBlock followed by a link
  // to the individual setlist page.
  const candidates = [];
  const chunks = artistHtml.split('setlistPreview');
  for (const chunk of chunks.slice(1)) {
    const date = parseDateBlock(chunk);
    const link = chunk.match(/href="\.\.\/(setlist\/[^"]+\.html)"/);
    if (date && link) {
      candidates.push({ date, url: `https://www.setlist.fm/${link[1]}` });
    }
  }
  return candidates;
}

function scrapeSetlistPage(html, url) {
  const date = parseDateBlock(html);
  const venue = html.match(/title="More setlists from [^"]*"><span>([^<]+)<\/span>/);
  const tour = html.match(/<span>Tour:<\/span>\s*<span><a[^>]*><span>([^<]+)/);
  const songs = [];
  // li classes seen in the wild: "song", "tape" (song played from tape),
  // "encore highlight" (set label), "setlistFluidAd hidden-print" (ad).
  const liRe = /<li class="setlistParts([^"]*)">([\s\S]*?)<\/li>/g;
  for (let m; (m = liRe.exec(html)); ) {
    const [, cls, body] = m;
    if (body.includes("<script") || cls.includes("Ad")) continue;
    if (cls.includes("song") || cls.includes("tape")) {
      const label =
        body.match(/class="songLabel"[^>]*>([^<]*)</) ??
        body.match(/class="songPart">\s*<span>([^<]*)</);
      if (!label) continue;
      const song = { type: "song", name: decodeEntities(label[1]).trim() };
      const infoParts = [];
      const info = body.match(/<small class="fontSmall">([\s\S]*?)<\/small>/);
      const infoText = info ? stripTags(info[1]) : "";
      if (infoText) infoParts.push(infoText.replace(/^\(|\)$/g, ""));
      if (cls.includes("tape")) infoParts.push("from tape");
      if (infoParts.length) song.info = `(${infoParts.join(", ")})`;
      songs.push(song);
    } else {
      const span = body.match(/<span>([^<]{1,60})<\/span>/);
      if (span) {
        const label = decodeEntities(span[1]).trim().replace(/:$/, "");
        if (label) songs.push({ type: "label", name: label });
      }
    }
  }
  return {
    url,
    event_date: date,
    venue: venue ? decodeEntities(venue[1]).trim() : null,
    tour: tour ? decodeEntities(tour[1]).trim() : null,
    songs,
  };
}

async function fetchViaScrape(name) {
  const artist = await scrapeArtistPageUrl(name);
  if (!artist) return { miss: "artist not found" };
  const res = await politeFetch(artist.url);
  if (!res.ok) throw new Error(`artist page HTTP ${res.status}`);
  const candidates = scrapeCandidates(await res.text())
    .filter((c) => c.date <= today)
    .slice(0, 5);
  for (const c of candidates) {
    const page = await politeFetch(c.url);
    if (!page.ok) continue;
    const setlist = scrapeSetlistPage(await page.text(), c.url);
    if (setlist.songs.some((s) => s.type === "song")) {
      return { setlist, matched: artist.name };
    }
  }
  return { miss: "no past setlist with songs" };
}

// ------------------------------------------------------------------- API path

async function apiGet(path) {
  const res = await politeFetch(`https://api.setlist.fm/rest/1.0${path}`, {
    "x-api-key": apiKey,
    Accept: "application/json",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API HTTP ${res.status} for ${path}`);
  return res.json();
}

async function fetchViaApi(name) {
  // Note: adding sort=relevance makes the API return 403 Forbidden.
  const search = await apiGet(
    `/search/artists?artistName=${encodeURIComponent(name)}&p=1`
  );
  const artists = search?.artist ?? [];
  if (artists.length === 0) return { miss: "artist not found" };
  const artist =
    artists.find((a) => normalize(a.name) === normalize(name)) ?? artists[0];

  const data = await apiGet(`/artist/${artist.mbid}/setlists?p=1`);
  for (const s of data?.setlist ?? []) {
    const [d, m, y] = s.eventDate.split("-"); // dd-MM-yyyy
    const date = `${y}-${m}-${d}`;
    if (date > today) continue;
    const songs = [];
    for (const set of s.sets?.set ?? []) {
      const label = set.name ?? (set.encore ? "Encore" : null);
      if (label) songs.push({ type: "label", name: label });
      for (const song of set.song ?? []) {
        if (!song.name) continue;
        const entry = { type: "song", name: song.name };
        const info = [
          song.cover ? `${song.cover.name} cover` : null,
          song.tape ? "from tape" : null,
        ].filter(Boolean);
        if (info.length) entry.info = `(${info.join(", ")})`;
        songs.push(entry);
      }
    }
    if (!songs.some((x) => x.type === "song")) continue;
    const venue = [s.venue?.name, s.venue?.city?.name, s.venue?.city?.country?.name]
      .filter(Boolean)
      .join(", ");
    return {
      matched: artist.name,
      setlist: {
        url: s.url,
        event_date: date,
        venue: venue || null,
        tour: s.tour?.name ?? null,
        songs,
      },
    };
  }
  return { miss: "no past setlist with songs" };
}

// ------------------------------------------------------------------------ run

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

const artists = await sql`
  SELECT a.id, a.slug, a.name
  FROM artists a
  LEFT JOIN artist_setlists s ON s.artist_id = a.id
  WHERE (${force} OR s.artist_id IS NULL)
    AND (${only ?? null}::text IS NULL OR a.slug = ${only ?? null})
  ORDER BY a.slug`;

console.log(
  `${artists.length} artist(s) to fetch via ${apiKey ? "API" : "scrape"}${
    Number.isFinite(limit) ? ` (limit ${limit})` : ""
  }`
);

let ok = 0;
const misses = [];
for (const artist of artists.slice(0, Number.isFinite(limit) ? limit : undefined)) {
  try {
    const result = apiKey
      ? await fetchViaApi(artist.name)
      : await fetchViaScrape(artist.name);
    if (result.miss) {
      misses.push(`${artist.slug}: ${result.miss}`);
      console.log(`  ✗ ${artist.slug} — ${result.miss}`);
      continue;
    }
    const { setlist, matched } = result;
    await sql`
      INSERT INTO artist_setlists
        (artist_id, matched_name, setlist_url, event_date, venue, tour, songs, fetched_at)
      VALUES
        (${artist.id}, ${matched}, ${setlist.url}, ${setlist.event_date},
         ${setlist.venue}, ${setlist.tour}, ${JSON.stringify(setlist.songs)}, now())
      ON CONFLICT (artist_id) DO UPDATE SET
        matched_name = EXCLUDED.matched_name,
        setlist_url = EXCLUDED.setlist_url,
        event_date = EXCLUDED.event_date,
        venue = EXCLUDED.venue,
        tour = EXCLUDED.tour,
        songs = EXCLUDED.songs,
        fetched_at = now()`;
    ok++;
    const nSongs = setlist.songs.filter((s) => s.type === "song").length;
    console.log(
      `  ✓ ${artist.slug} — ${setlist.event_date} ${setlist.venue ?? "?"} (${nSongs} songs)`
    );
  } catch (err) {
    misses.push(`${artist.slug}: ${err.message}`);
    console.log(`  ✗ ${artist.slug} — ${err.message}`);
  }
}

console.log(`\nDone: ${ok} stored, ${misses.length} missed.`);
if (misses.length) {
  console.log("Misses:");
  for (const m of misses) console.log(`  ${m}`);
}
