import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DashboardShell from "@/components/DashboardShell";

// Server-side auth guard (FR-1.3). The client shell handles live data + logout.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <DashboardShell role={session.role} feederId={session.feederId} />;
}
