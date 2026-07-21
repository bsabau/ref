import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getTimetable, getFavoriteIds } from "@/lib/db";
import Timetable from "@/components/Timetable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");

  const [rows, favIds] = await Promise.all([
    getTimetable(),
    getFavoriteIds(user.id),
  ]);

  return <Timetable user={user} rows={rows} initialFavs={favIds} />;
}
