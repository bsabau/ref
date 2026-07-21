import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sessionCookie } from "@/lib/auth";

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,29}$/u;

export async function POST(req: NextRequest) {
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
