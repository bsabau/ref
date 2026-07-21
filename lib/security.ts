import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF defense-in-depth on top of SameSite=Lax: browser requests always carry
 * an Origin header on cross-origin (and same-origin POST) fetches — reject any
 * that don't match this deployment's host. Requests without an Origin header
 * (curl, cron) carry no ambient browser credentials worth protecting.
 */
export function rejectCrossOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host === req.headers.get("host")) return null;
  } catch {
    /* malformed origin falls through to rejection */
  }
  return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
}

export function requireJson(req: NextRequest): NextResponse | null {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.toLowerCase().includes("application/json")) return null;
  return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
}
