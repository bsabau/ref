import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sessionCookie } from "@/lib/auth";
import { rejectCrossOrigin, requireJson } from "@/lib/security";

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,29}$/u;
const MAX_USERS = 50; // friends-only app: hard cap on account creation

export async function POST(req: NextRequest) {
  const denied = rejectCrossOrigin(req) ?? requireJson(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const create = Boolean(body.create);

  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "Name must be 1-30 letters, numbers, spaces or _.-" },
      { status: 400 }
    );
  }

  const found = await sql`
    SELECT id, name FROM users WHERE lower(name) = lower(${name})`;

  let user = found[0] as { id: number; name: string } | undefined;

  if (!user) {
    if (!create) {
      return NextResponse.json({ unknown: true }, { status: 404 });
    }
    const [{ count }] = (await sql`SELECT count(*)::int AS count FROM users`) as [
      { count: number }
    ];
    if (count >= MAX_USERS) {
      return NextResponse.json({ error: "User limit reached" }, { status: 403 });
    }
    const inserted = await sql`
      INSERT INTO users (name) VALUES (${name})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name`;
    user = inserted[0] as { id: number; name: string };
  }

  const res = NextResponse.json({ id: user.id, name: user.name });
  res.cookies.set(sessionCookie(user));
  return res;
}
