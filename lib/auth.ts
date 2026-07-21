import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "fest_user";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  name: string;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function getUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!timingSafeEq(sig, sign(payload))) return null;

  const parts = payload.split(":");
  if (parts.length < 3) return null;
  const id = Number(parts[0]);
  const exp = Number(parts[1]);
  const name = decodeURIComponent(parts.slice(2).join(":"));
  if (!Number.isInteger(id) || id < 1 || !name) return null;
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { id, name };
}

export function sessionCookie(user: SessionUser) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${user.id}:${exp}:${encodeURIComponent(user.name)}`;
  return {
    name: COOKIE,
    value: `${payload}.${sign(payload)}`,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export const COOKIE_NAME = COOKIE;
