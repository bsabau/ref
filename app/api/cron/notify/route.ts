import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import webpush from "web-push";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const SEND_TIMEOUT_MS = 5000;
const SEND_CONCURRENCY = 10;
const MAX_ROWS_PER_RUN = 500;

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidReady = true;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // fail closed on missing/weak configuration
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = crypto.createHash("sha256").update(header).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

interface DueRow {
  user_id: number;
  performance_id: number;
  band_name: string;
  stage: string;
  start_time: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ensureVapid();

  // Sets starting within the next 15 minutes (festival local time),
  // starred by users who have push subscriptions and weren't notified yet.
  const due = (await sql`
    SELECT f.user_id, p.id AS performance_id, p.band_name, s.name AS stage,
           to_char(p.starts_at, 'HH24:MI') AS start_time,
           ps.endpoint, ps.p256dh, ps.auth
    FROM favorites f
    JOIN performances p ON p.id = f.performance_id
    JOIN stages s ON s.id = p.stage_id
    JOIN push_subscriptions ps ON ps.user_id = f.user_id
    LEFT JOIN notifications_sent ns
      ON ns.user_id = f.user_id AND ns.performance_id = p.id
    WHERE ns.user_id IS NULL
      AND p.starts_at > (now() AT TIME ZONE 'Europe/Bucharest')
      AND p.starts_at <= (now() AT TIME ZONE 'Europe/Bucharest') + interval '15 minutes'
    LIMIT ${MAX_ROWS_PER_RUN}`) as DueRow[];

  let sent = 0;
  let failed = 0;
  const notified = new Set<string>();
  const deadEndpoints = new Set<string>();

  async function deliver(row: DueRow) {
    const payload = JSON.stringify({
      title: `${row.band_name} starts at ${row.start_time}`,
      body: `${row.stage} — get moving! 🤘`,
      tag: `perf-${row.performance_id}`,
      url: "/",
    });
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { timeout: SEND_TIMEOUT_MS, TTL: 900 }
      );
      sent++;
      notified.add(`${row.user_id}:${row.performance_id}`);
    } catch (err: unknown) {
      failed++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        deadEndpoints.add(row.endpoint);
      }
    }
  }

  for (let i = 0; i < due.length; i += SEND_CONCURRENCY) {
    await Promise.allSettled(due.slice(i, i + SEND_CONCURRENCY).map(deliver));
  }

  for (const endpoint of deadEndpoints) {
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  }

  // mark as sent (once per user+performance, even if they had several devices)
  for (const key of notified) {
    const [userId, perfId] = key.split(":").map(Number);
    await sql`
      INSERT INTO notifications_sent (user_id, performance_id)
      VALUES (${userId}, ${perfId})
      ON CONFLICT DO NOTHING`;
  }

  return NextResponse.json({ due: due.length, sent, failed });
}
