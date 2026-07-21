import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

export interface PerformanceRow {
  id: number;
  day_number: number;
  day_date: string;
  day_of_week: string;
  stage: string;
  band_name: string;
  starts_at: string; // ISO local, e.g. "2026-07-27T15:10:00"
  ends_at: string;
  is_headliner: boolean;
  slug: string;
  artist_name: string;
  genres: string[];
  country: string | null;
  local_image: string;
}

export interface ArtistRow {
  id: number;
  slug: string;
  name: string;
  lineup_name: string | null;
  country: string | null;
  genres: string[];
  bio: string | null;
  source_url: string | null;
  festival_url: string | null;
  socials: string[];
  local_image: string;
}

export async function getTimetable(): Promise<PerformanceRow[]> {
  const rows = await sql`
    SELECT p.id, p.day_number, p.day_date::text, p.day_of_week,
           s.name AS stage, p.band_name,
           to_char(p.starts_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
           to_char(p.ends_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
           p.is_headliner,
           a.slug, a.name AS artist_name, a.genres, a.country, a.local_image
    FROM performances p
    JOIN stages s ON s.id = p.stage_id
    JOIN artists a ON a.id = p.artist_id
    ORDER BY p.starts_at`;
  return rows as PerformanceRow[];
}

export async function getArtist(slug: string): Promise<ArtistRow | null> {
  const rows = await sql`
    SELECT id, slug, name, lineup_name, country, genres, bio,
           source_url, festival_url, socials, local_image
    FROM artists WHERE slug = ${slug}`;
  return (rows[0] as ArtistRow) ?? null;
}

export async function getArtistPerformance(artistId: number) {
  const rows = await sql`
    SELECT p.id, p.day_number, p.day_of_week, s.name AS stage,
           to_char(p.starts_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
           to_char(p.ends_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
           p.band_name, p.is_headliner
    FROM performances p
    JOIN stages s ON s.id = p.stage_id
    WHERE p.artist_id = ${artistId}`;
  return rows as {
    id: number;
    day_number: number;
    day_of_week: string;
    stage: string;
    starts_at: string;
    ends_at: string;
    band_name: string;
    is_headliner: boolean;
  }[];
}

export async function getFavoriteIds(userId: number): Promise<number[]> {
  const rows = await sql`
    SELECT performance_id FROM favorites WHERE user_id = ${userId}`;
  return rows.map((r) => (r as { performance_id: number }).performance_id);
}
