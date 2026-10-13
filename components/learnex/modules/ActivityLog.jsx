import { useCallback, useEffect, useState } from "react";
import { Badge, inputCls } from "@/components/learnex/ui";
import { listAudit } from "@/lib/learnex/auth-client";
import { STORE_LABELS } from "@/lib/auth/permissions";

/* =====================================================================
   ACTIVITY LOG — who signed in, who changed which records, and when.
===================================================================== */

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "auth.", label: "Sign-ins & passwords" },
  { value: "data.", label: "Data changes" },
  { value: "user.", label: "Staff accounts" },
  { value: "role.", label: "Roles" },
];

const TONE = { auth: "blue", data: "green", user: "amber", role: "amber" };

function describe(e) {
  const d = e.details || {};
  switch (e.action) {
    case "auth.login":
      return "Signed in";
    case "auth.logout":
      return "Signed out";
    case "auth.setup":
      return "Created the owner account";
    case "auth.password_change":
      return "Changed their password";
    case "auth.login_failed":
      return `Failed sign-in as “${e.target}” (${{ unknown_user: "no such user", wrong_password: "wrong password", locked: "account locked", disabled: "account disabled" }[d.reason] || d.reason})${d.lockedMinutes ? ` — locked for ${d.lockedMinutes} min` : ""}`;
    case "data.save":
      return (
        "Saved changes to " +
        (d.changes || [])
          .map((c) => {
            const parts = [];
            if (c.created) parts.push(`${c.created} new`);
            if (c.updated) parts.push(`${c.updated} changed`);
            if (c.deleted) parts.push(`${c.deleted} deleted`);
            return `${STORE_LABELS[c.store] || c.store}${parts.length ? ` (${parts.join(", ")})` : " (order)"}`;
          })
          .join(", ")
      );
    case "data.import":
      return `Imported data: ${(d.modules || []).map((m) => STORE_LABELS[m.store] || m.store).join(", ") || "demo data"}`;
    case "data.reset":
      return "Factory reset — all business records deleted";
    case "user.create":
      return `Added user “${e.target}” (${(d.roles || []).join(", ")})`;
    case "user.update": {
      const parts = [];
      if (d.rolesAdded) parts.push(`gave role ${d.rolesAdded.join(", ")}`);
      if (d.rolesRemoved) parts.push(`removed role ${d.rolesRemoved.join(", ")}`);
      if (d.status) parts.push(d.status === "disabled" ? "disabled the account" : "re-enabled the account");
      for (const k of ["name", "username", "email"])
        if (d[k] !== undefined) parts.push(`changed ${k} to “${d[k] ?? ""}”`);
      return `Updated user “${e.target}”: ${parts.join("; ")}`;
    }
    case "user.password_reset":
      return `Reset the password of “${e.target}”`;
    case "user.sign_out":
      return `Signed “${e.target}” out of ${d.sessions} session(s)`;
    case "role.create":
      return `Created role “${e.target}”`;
    case "role.update":
      return `Changed role “${e.target}”${d.added?.length ? ` · added ${d.added.join(", ")}` : ""}${d.removed?.length ? ` · removed ${d.removed.join(", ")}` : ""}`;
    case "role.delete":
      return `Deleted role “${e.target}”`;
    default:
      return `${e.action}${e.target ? ` — ${e.target}` : ""}`;
  }
}

export function ActivityLog({ dark, cardBg, subText, inputBg, hoverRow }) {
  const [action, setAction] = useState("");
  const [user, setUser] = useState("");
  const [entries, setEntries] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (before) => {
      try {
        const page = await listAudit({ action, user: user.trim(), before, limit: 100 });
        setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
        setNextBefore(page.nextBefore);
        setError("");
        setLoaded(true);
      } catch (e) {
        setError(e.message);
      }
    },
    [action, user],
  );
  useEffect(() => {
    const t = setTimeout(() => load(), user ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, user]);

  return (
    <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
      <div className="p-5 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div>
          <h3 className="font-semibold">Activity log</h3>
          <p className={`text-xs ${subText}`}>
            Newest first. Entries can&apos;t be edited or deleted from the app.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className={inputCls(inputBg)}
            style={{ width: 200 }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Filter by username"
            className={inputCls(inputBg)}
            style={{ width: 180 }}
          />
        </div>
      </div>
      {error && <p className="px-5 pb-3 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr
              className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
            >
              <th className="font-medium py-3 px-5">When</th>
              <th className="font-medium py-3 px-2">Who</th>
              <th className="font-medium py-3 px-2">What happened</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow}`}
              >
                <td className={`py-3 px-5 text-xs whitespace-nowrap ${subText}`}>
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="py-3 px-2 whitespace-nowrap">{e.username || "—"}</td>
                <td className="py-3 px-2">
                  <span className="mr-2">
                    <Badge tone={TONE[e.action.split(".")[0]] || "slate"}>{e.action.split(".")[0]}</Badge>
                  </span>
                  {describe(e)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className={`text-center py-10 text-sm ${subText}`}>
                  {loaded ? "No activity matches." : "Loading…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {nextBefore && (
        <div className="p-4 text-center">
          <button
            onClick={() => load(nextBefore)}
            className={`text-sm font-medium px-4 py-2 rounded-xl border ${dark ? "border-slate-700" : "border-slate-200"}`}
          >
            Show older entries
          </button>
        </div>
      )}
    </div>
  );
}
