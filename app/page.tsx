import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getTimetable, getFavoriteIds } from "@/lib/db";
import Timetable from "@/components/Timetable";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; stage?: string; q?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const [rows, favIds] = await Promise.all([
    getTimetable(),
    getFavoriteIds(user.id),
  ]);

  return (
    <Timetable
      key={`${sp.day ?? ""}|${sp.stage ?? ""}|${sp.q ?? ""}`}
      user={user}
      rows={rows}
      initialFavs={favIds}
      initialDay={sp.day ? Number(sp.day) : undefined}
      initialStage={sp.stage}
      initialQuery={sp.q}
    />
  );
}
