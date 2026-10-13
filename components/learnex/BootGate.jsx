import { useEffect, useRef, useState } from "react";
import { LearnexERP } from "@/components/learnex/LearnexERP";
import { BACKUP_MODULES } from "@/lib/learnex/backup";
import {
  importStores,
  loadFromDatabase,
  readBackupFileStores,
  readBrowserStorageStores,
  readFolderStores,
} from "@/lib/learnex/persistence";

/* =====================================================================
   BOOT SEQUENCE — load everything from the database before the app
   mounts (LearnexERP reads its data on first render). If the database
   has never been set up, offer a one-time import of existing data.
===================================================================== */

// Runs once per page load (React StrictMode mounts effects twice in development).
let initialLoad = null;
function loadOnce() {
  initialLoad ??= loadFromDatabase();
  return initialLoad;
}

const shellStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  fontFamily: "Inter,system-ui,sans-serif",
  background: "#0f172a",
  padding: 24,
};
const cardStyle = {
  maxWidth: 420,
  width: "100%",
  background: "#ffffff",
  borderRadius: 20,
  padding: 32,
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};
const buttonStyle = {
  width: "100%",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  padding: "12px 16px",
  borderRadius: 12,
  cursor: "pointer",
  marginTop: 8,
};
const secondaryButtonStyle = { ...buttonStyle, background: "#eff6ff", color: "#1d4ed8" };
const linkStyle = {
  width: "100%",
  background: "transparent",
  color: "#64748b",
  border: "none",
  fontSize: 13,
  padding: 10,
  cursor: "pointer",
  marginTop: 4,
  textDecoration: "underline",
};
const headingStyle = { margin: "0 0 8px", fontSize: 18, color: "#0f172a" };
const bodyStyle = { color: "#64748b", fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" };
const errorStyle = { color: "#dc2626", fontSize: 12, margin: "0 0 12px", whiteSpace: "pre-wrap" };

function GateShell({ children }) {
  return (
    <div style={shellStyle}>
      <div style={cardStyle}>{children}</div>
    </div>
  );
}

function countLabel(key, value) {
  if (key === "settings") return "included";
  return Array.isArray(value) ? `${value.length} record(s)` : "—";
}

export default function BootGate() {
  const [phase, setPhase] = useState({ name: "loading" });
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;
    loadOnce().then(
      ({ initialized }) => active && setPhase({ name: initialized ? "app" : "import" }),
      (e) => active && setPhase({ name: "offline", error: e.message }),
    );
    return () => {
      active = false;
    };
  }, []);

  function retry() {
    initialLoad = null;
    setPhase({ name: "loading" });
    loadOnce().then(
      ({ initialized }) => setPhase({ name: initialized ? "app" : "import" }),
      (e) => setPhase({ name: "offline", error: e.message }),
    );
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

  if (phase.name === "app") return <LearnexERP />;

  if (phase.name === "offline") {
    return (
      <GateShell>
        <h2 style={headingStyle}>Can&apos;t reach the database</h2>
        <p style={bodyStyle}>
          LEARNEX ERP couldn&apos;t load your data. Check that PostgreSQL is running and that the app&apos;s
          DATABASE_URL is correct, then try again.
        </p>
        <p style={errorStyle}>{phase.error}</p>
        <button style={buttonStyle} onClick={retry}>
          Try Again
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
