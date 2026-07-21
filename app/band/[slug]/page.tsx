import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getArtist, getArtistPerformance, getFavoriteIds } from "@/lib/db";
import StarButton from "@/components/StarButton";

export const dynamic = "force-dynamic";

const STAGE_COLOR: Record<string, string> = {
  "Adrian Rugina Stage": "green",
  "Brasov Stage": "purple",
  "Andrei Calmuc Stage": "orange",
};

const fmtTime = (iso: string) => iso.slice(11, 16);

function socialLabel(url: string): string {
  if (url.includes("facebook")) return "Facebook";
  if (url.includes("instagram")) return "Instagram";
  if (url.includes("youtube")) return "YouTube";
  if (url.includes("spotify")) return "Spotify";
  if (url.includes("bandcamp")) return "Bandcamp";
  if (url.includes("tiktok")) return "TikTok";
  if (url.includes("twitter") || url.includes("//x.")) return "X / Twitter";
  return new URL(url).hostname.replace("www.", "");
}

export default async function BandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const artist = await getArtist(slug);
  if (!artist) notFound();

  const [perfs, favIds] = await Promise.all([
    getArtistPerformance(artist.id),
    getFavoriteIds(user.id),
  ]);
  const perf = perfs[0];
  const title = perf?.band_name ?? artist.name;
  const showSub = artist.name.toLowerCase() !== title.toLowerCase();

  return (
    <div className="shell">
      <div style={{ padding: "8px 0" }}>
        <Link href="/" className="backlink">
          ← Back to lineup
        </Link>
      </div>

      <div className="band-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/${artist.local_image}`} alt={artist.name} />
      </div>

      <h1 className="band-title">{title}</h1>
      {showSub && <div className="band-sub">{artist.name}</div>}
      {artist.country && <div className="band-sub">{artist.country}</div>}

      <div className="meta" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
        {artist.genres.map((g) => (
          <Link key={g} href={`/?q=${encodeURIComponent(g)}`} className="chip chip-link">
            {g}
          </Link>
        ))}
      </div>

      {perf && (
        <div className={`slotbox card stage-${STAGE_COLOR[perf.stage] ?? "purple"}`} style={{ padding: "12px 8px 12px 14px" }}>
          <Link
            href={`/?day=${perf.day_number}&stage=${encodeURIComponent(perf.stage)}`}
            className="slotbox-link"
            title="Show this day and stage in the timetable"
          >
            <div className="time">
              Day {perf.day_number} · {perf.day_of_week}
            </div>
            <div className="head-font" style={{ fontSize: 16, fontWeight: 600 }}>
              {perf.stage} <span className="slot-chevron">›</span>
            </div>
            <div className="time">
              {fmtTime(perf.starts_at)} – {fmtTime(perf.ends_at)}
            </div>
          </Link>
          <StarButton performanceId={perf.id} initial={favIds.includes(perf.id)} />
        </div>
      )}

      {artist.bio && (
        <div className="bio">
          {artist.bio.split(/\n\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {artist.socials.length > 0 && (
        <>
          <div className="section-label">Links</div>
          <div className="social-list">
            {artist.socials.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer">
                {socialLabel(s)}
              </a>
            ))}
            {artist.festival_url && (
              <a href={artist.festival_url} target="_blank" rel="noreferrer">
                Festival page
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
