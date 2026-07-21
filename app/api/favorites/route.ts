import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const performanceId = Number(body.performanceId);
  if (!Number.isInteger(performanceId)) {
    return NextResponse.json({ error: "Bad performanceId" }, { status: 400 });
  }

  const deleted = await sql`
    DELETE FROM favorites
    WHERE user_id = ${user.id} AND performance_id = ${performanceId}
    RETURNING performance_id`;

  if (deleted.length > 0) {
    return NextResponse.json({ favorited: false });
  }

  await sql`
    INSERT INTO favorites (user_id, performance_id)
    VALUES (${user.id}, ${performanceId})
    ON CONFLICT DO NOTHING`;
  return NextResponse.json({ favorited: true });
}
