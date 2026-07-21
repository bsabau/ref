import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { rejectCrossOrigin, requireJson } from "@/lib/security";

const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_ENDPOINT_LENGTH = 1000;
// base64url payloads: p256dh is an uncompressed P-256 point (~87 chars), auth ~22 chars
const P256DH_RE = /^[A-Za-z0-9_-]{80,130}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{16,60}$/;

// Push services used by real-world browsers (Chrome/Edge/Firefox/Safari/Opera).
const ALLOWED_PUSH_HOSTS: RegExp[] = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname));
}

export async function POST(req: NextRequest) {
  const denied = rejectCrossOrigin(req) ?? requireJson(req);
  if (denied) return denied;

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;

  if (
    !validEndpoint(sub?.endpoint) ||
    typeof p256dh !== "string" ||
    !P256DH_RE.test(p256dh) ||
    typeof auth !== "string" ||
    !AUTH_RE.test(auth)
  ) {
    return NextResponse.json({ error: "Bad subscription" }, { status: 400 });
  }

  const [{ count }] = (await sql`
    SELECT count(*)::int AS count FROM push_subscriptions
    WHERE user_id = ${user.id} AND endpoint <> ${sub.endpoint}`) as [
    { count: number }
  ];
  if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
    return NextResponse.json({ error: "Too many subscriptions" }, { status: 409 });
  }

  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${user.id}, ${sub.endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = rejectCrossOrigin(req) ?? requireJson(req);
  if (denied) return denied;

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return NextResponse.json({ error: "Bad endpoint" }, { status: 400 });
  }

  await sql`
    DELETE FROM push_subscriptions
    WHERE endpoint = ${endpoint} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
