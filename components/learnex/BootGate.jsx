import { useCallback, useEffect, useRef, useState } from "react";
import { LearnexERP } from "@/components/learnex/LearnexERP";
import { BACKUP_MODULES } from "@/lib/learnex/backup";
import {
  importStores,
  loadFromDatabase,
  readBackupFileStores,
  readBrowserStorageStores,
  readFolderStores,
  setSignedOutHandler,
} from "@/lib/learnex/persistence";
import { getMe, logout } from "@/lib/learnex/auth-client";
import { ForcedPasswordChangeScreen, LoginScreen, SetupOwnerScreen } from "@/components/learnex/AuthScreens";
import {
  GateButton,
  GateError,
  GateHeading,
  GateLink,
  GateLoading,
  GateShell,
  GateText,
} from "@/components/learnex/gate";
import { AlertTriangle, Database, Download, Lock } from "@/components/learnex/icons";

/* =====================================================================
   BOOT SEQUENCE
   1. Who is signed in? (first run: create the owner account)
   2. Sign in → if on a one-time password, choose a new one
   3. Load the modules this user may see (LearnexERP reads them on first
      render). If the database was never set up, someone allowed to
      restore data can import existing data once.
===================================================================== */

function countLabel(key, value) {
  if (key === "settings") return "included";
  return Array.isArray(value) ? `${value.length} record(s)` : "—";
}

export default function BootGate() {
  const [phase, setPhase] = useState({ name: "loading" });
  const [user, setUser] = useState(null);
  const fileInput = useRef(null);

  // Loads the app's data for the signed-in user.
  const openApp = useCallback(async (me) => {
    setPhase({ name: "loading" });
    try {
      const { initialized } = await loadFromDatabase();
      if (initialized) setPhase({ name: "app" });
      else setPhase({ name: me.permissions.includes("data.restore") ? "import" : "notReady" });
    } catch (e) {
      if (e.status === 401) setPhase({ name: "login" });
      else if (e.code === "password_change_required") setPhase({ name: "password" });
      else setPhase({ name: "offline", error: e.message });
    }
  }, []);

  // Works out the first screen from the session.
  const start = useCallback(
    async (notice) => {
      setPhase({ name: "loading" });
      try {
        const me = await getMe();
        setUser(me.user);
        if (me.setupRequired) setPhase({ name: "setup", setupAvailable: me.setupAvailable });
        else if (!me.user) setPhase({ name: "login", notice });
        else if (me.user.mustChangePassword) setPhase({ name: "password" });
        else await openApp(me.user);
      } catch (e) {
        setPhase({ name: "offline", error: e.message });
      }
    },
    [openApp],
  );

  useEffect(() => {
    // Defer the first check so it doesn't run synchronously inside the effect.
    const t = setTimeout(() => start(), 0);
    // If the server ends the session mid-use (expired, signed out elsewhere, account disabled).
    setSignedOutHandler(() => {
      setUser(null);
      setPhase({ name: "login", notice: "Your session has ended. Please sign in again." });
    });
    return () => clearTimeout(t);
  }, [start]);

  async function signOut() {
    try {
      await logout();
    } catch {}
    setUser(null);
    setPhase({ name: "login" });
  }

  function review(source, stores) {
    if (!Object.keys(stores).length) {
      setPhase({ name: "import", error: `No LEARNEX data was found in ${source}.` });
      return;
    }
    setPhase({ name: "review", source, stores });
  }

  async function fromFolder() {
    try {
      const { name, stores } = await readFolderStores();
      review(`the folder "${name}"`, stores);
    } catch (e) {
      if (e && e.name === "AbortError") return; // picker closed — stay on this screen
      setPhase({ name: "import", error: e.message });
    }
  }

  async function fromBackupFile(file) {
    try {
      review(`"${file.name}"`, await readBackupFileStores(file));
    } catch (e) {
      setPhase({ name: "import", error: e.message });
    }
  }

  async function runImport(stores) {
    setPhase({ name: "loading" });
    try {
      await importStores(stores);
      await loadFromDatabase();
      setPhase({ name: "app" });
    } catch (e) {
      setPhase({ name: "import", error: `Import failed: ${e.message}` });
    }
  }

  if (phase.name === "app" && user) {
    return <LearnexERP auth={{ user, can: (p) => user.permissions.includes(p), signOut }} />;
  }

  if (phase.name === "setup")
    return <SetupOwnerScreen setupAvailable={phase.setupAvailable} onDone={() => start()} />;
  if (phase.name === "login") return <LoginScreen notice={phase.notice} onDone={() => start()} />;
  if (phase.name === "password" && user) {
    return <ForcedPasswordChangeScreen user={user} onDone={() => start()} onSignOut={signOut} />;
  }

  if (phase.name === "offline") {
    return (
      <GateShell>
        <GateHeading icon={AlertTriangle}>Can&apos;t reach the database</GateHeading>
        <GateText>
          LEARNEX ERP couldn&apos;t load your data. Check that MySQL is running and that the app&apos;s
          DATABASE_URL is correct, then try again.
        </GateText>
        <GateError>{phase.error}</GateError>
        <GateButton onClick={() => start()}>Try Again</GateButton>
      </GateShell>
    );
  }

  if (phase.name === "notReady") {
    return (
      <GateShell>
        <GateHeading icon={Lock}>Not set up yet</GateHeading>
        <GateText>
          The business data hasn&apos;t been set up yet. Ask the owner to sign in and finish the setup, then
          try again.
        </GateText>
        <GateButton onClick={() => start()}>Try Again</GateButton>
        <GateLink onClick={signOut}>Sign out</GateLink>
      </GateShell>
    );
  }

  if (phase.name === "review") {
    return (
      <GateShell>
        <GateHeading icon={Download}>Import this data?</GateHeading>
        <GateText>Found in {phase.source}:</GateText>
        <div className="rounded-xl border border-slate-200 mb-5 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {BACKUP_MODULES.filter((m) => phase.stores[m.key] !== undefined).map((m) => (
                <tr key={m.key}>
                  <td className="px-4 py-2 text-slate-700">{m.label}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                    {countLabel(m.key, phase.stores[m.key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <GateText className="!mt-0">Modules not listed start with the demo data.</GateText>
        <GateButton onClick={() => runImport(phase.stores)}>Import into Database</GateButton>
        <GateLink onClick={() => setPhase({ name: "import" })}>Back</GateLink>
      </GateShell>
    );
  }

  if (phase.name === "import") {
    const browserStores = readBrowserStorageStores();
    const hasBrowserData = Object.keys(browserStores).length > 0;
    return (
      <GateShell>
        <GateHeading icon={Database}>Set up your database</GateHeading>
        <GateText>
          The database is empty. Bring in the data from your previous LEARNEX setup, or start with the demo
          data. This is only asked once.
        </GateText>
        <GateError>{phase.error}</GateError>
        <div className="space-y-2.5">
          {hasBrowserData && (
            <GateButton onClick={() => review("this browser's storage", browserStores)}>
              Import from This Browser
            </GateButton>
          )}
          {typeof window.showDirectoryPicker === "function" && (
            <GateButton variant={hasBrowserData ? "secondary" : "primary"} onClick={fromFolder}>
              Import from Data Folder…
            </GateButton>
          )}
          <GateButton
            variant={hasBrowserData || typeof window.showDirectoryPicker === "function" ? "secondary" : "primary"}
            onClick={() => fileInput.current && fileInput.current.click()}
          >
            Import from Backup File…
          </GateButton>
        </div>
        <input aria-label="Backup file to import"
          ref={fileInput}
          type="file"
          accept=".html,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (file) fromBackupFile(file);
          }}
        />
        <GateLink onClick={() => runImport({})}>Start with demo data</GateLink>
      </GateShell>
    );
  }

  return <GateLoading />;
}
