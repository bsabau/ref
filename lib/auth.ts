import { cookies } from "next/headers";

const COOKIE = "fest_user";

export interface SessionUser {
  id: number;
  name: string;
}

export async function getUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep < 1) return null;
  const id = Number(raw.slice(0, sep));
  const name = decodeURIComponent(raw.slice(sep + 1));
  if (!Number.isInteger(id) || !name) return null;
  return { id, name };
}

export function sessionCookie(user: SessionUser) {
  return {
    name: COOKIE,
    value: `${user.id}:${encodeURIComponent(user.name)}`,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  };
}

export const COOKIE_NAME = COOKIE;
