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
  GateShell,
  bodyStyle,
  buttonStyle,
  errorStyle,
  headingStyle,
  linkStyle,
  secondaryButtonStyle,
} from "@/components/learnex/gate";

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
        <h2 style={headingStyle}>Can&apos;t reach the database</h2>
        <p style={bodyStyle}>
          LEARNEX ERP couldn&apos;t load your data. Check that PostgreSQL is running and that the app&apos;s
          DATABASE_URL is correct, then try again.
        </p>
        <p style={errorStyle}>{phase.error}</p>
        <button style={buttonStyle} onClick={() => start()}>
          Try Again
        </button>
      </GateShell>
    );
  }

  if (phase.name === "notReady") {
    return (
      <GateShell>
        <h2 style={headingStyle}>Not set up yet</h2>
        <p style={bodyStyle}>
          The business data hasn&apos;t been set up yet. Ask the owner to sign in and finish the setup, then
          try again.
        </p>
        <button style={buttonStyle} onClick={() => start()}>
          Try Again
        </button>
        <button style={linkStyle} onClick={signOut}>
          Sign out
        </button>
      </GateShell>
    );
  }

  if (phase.name === "review") {
    return (
      <GateShell>
        <h2 style={headingStyle}>Import this data?</h2>
        <p style={bodyStyle}>Found in {phase.source}:</p>
        <table
          style={{
            width: "100%",
            fontSize: 13,
            color: "#334155",
            marginBottom: 16,
            borderCollapse: "collapse",
          }}
        >
          <tbody>
            {BACKUP_MODULES.filter((m) => phase.stores[m.key] !== undefined).map((m) => (
              <tr key={m.key}>
                <td style={{ padding: "3px 0" }}>{m.label}</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#64748b" }}>
                  {countLabel(m.key, phase.stores[m.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={bodyStyle}>Modules not listed start with the demo data.</p>
        <button style={buttonStyle} onClick={() => runImport(phase.stores)}>
          Import into Database
        </button>
        <button style={linkStyle} onClick={() => setPhase({ name: "import" })}>
          Back
        </button>
      </GateShell>
    );
  }

  if (phase.name === "import") {
    const browserStores = readBrowserStorageStores();
    const hasBrowserData = Object.keys(browserStores).length > 0;
    return (
      <GateShell>
        <h2 style={headingStyle}>Set up your database</h2>
        <p style={bodyStyle}>
          The database is empty. Bring in the data from your previous LEARNEX setup, or start with the demo
          data. This is only asked once.
        </p>
        {phase.error && <p style={errorStyle}>{phase.error}</p>}
        {hasBrowserData && (
          <button style={buttonStyle} onClick={() => review("this browser's storage", browserStores)}>
            Import from This Browser
          </button>
        )}
        {typeof window.showDirectoryPicker === "function" && (
          <button style={hasBrowserData ? secondaryButtonStyle : buttonStyle} onClick={fromFolder}>
            Import from Data Folder…
          </button>
        )}
        <button style={secondaryButtonStyle} onClick={() => fileInput.current && fileInput.current.click()}>
          Import from Backup File…
        </button>
        <input
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
        <button style={linkStyle} onClick={() => runImport({})}>
          Start with demo data
        </button>
      </GateShell>
    );
  }

  return (
    <GateShell>
      <p style={{ color: "#64748b", fontSize: 14, margin: 0, textAlign: "center" }}>Loading your data…</p>
    </GateShell>
  );
}
