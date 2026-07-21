import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { rejectCrossOrigin } from "@/lib/security";

export async function POST(req: NextRequest) {
  const denied = rejectCrossOrigin(req);
  if (denied) return denied;

  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
  return res;
}
