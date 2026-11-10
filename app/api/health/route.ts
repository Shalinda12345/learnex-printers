import { pool } from "@/lib/server/db";

// Uptime check for monitors (UptimeRobot, Vercel checks, ...): 200 when the app can reach
// its database, 503 when it cannot. It needs no sign-in and says nothing else — no versions,
// no host names, no error text.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[health] database check failed", e);
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
