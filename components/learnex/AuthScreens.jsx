import { useState } from "react";
import { changePassword, login, registerOwner } from "@/lib/learnex/auth-client";
import {
  GateField,
  GateShell,
  bodyStyle,
  buttonStyle,
  errorStyle,
  headingStyle,
  linkStyle,
} from "@/components/learnex/gate";

const MIN_PASSWORD = 8;

function usePending() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** First run: create the owner account. Needs the setup code from the server's .env. */
export function SetupOwnerScreen({ setupAvailable, onDone }) {
  const [form, setForm] = useState({
    setupCode: "",
    name: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const { busy, error, setError, run } = usePending();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!setupAvailable) {
    return (
      <GateShell>
        <h2 style={headingStyle}>Create the owner account</h2>
        <p style={bodyStyle}>
          No accounts exist yet. To create the first (owner) account, the server needs a setup code: add a
          line
          <b> AUTH_SETUP_CODE=…</b> with a long secret value to the server&apos;s .env file and restart it.
        </p>
      </GateShell>
    );
  }

  function submit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("The two passwords don't match.");
    const { setupCode, name, username, email, password } = form;
    run(async () => {
      await registerOwner({ setupCode, name, username, email, password });
      await onDone();
    });
  }

  return (
    <GateShell>
      <h2 style={headingStyle}>Create the owner account</h2>
      <p style={bodyStyle}>
        This is the first account. The owner can do everything, including adding staff accounts and choosing
        what each person may do. You&apos;ll find the setup code in the server&apos;s .env file
        (AUTH_SETUP_CODE).
      </p>
      <form onSubmit={submit}>
        <GateField
          label="Setup code"
          value={form.setupCode}
          onChange={set("setupCode")}
          autoComplete="off"
          required
        />
        <GateField label="Your name" value={form.name} onChange={set("name")} autoComplete="name" required />
        <GateField
          label="Username"
          value={form.username}
          onChange={set("username")}
          autoComplete="username"
          hint="Used to sign in, e.g. “aarav”."
          required
        />
        <GateField
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={set("email")}
          autoComplete="email"
        />
        <GateField
          label="Password"
          type="password"
          value={form.password}
          onChange={set("password")}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          required
        />
        <GateField
          label="Repeat password"
          type="password"
          value={form.confirm}
          onChange={set("confirm")}
          autoComplete="new-password"
          required
        />
        {error && <p style={errorStyle}>{error}</p>}
        <button type="submit" style={buttonStyle} disabled={busy}>
          {busy ? "Creating…" : "Create Owner Account"}
        </button>
      </form>
    </GateShell>
  );
}

export function LoginScreen({ onDone, notice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = usePending();

  function submit(e) {
    e.preventDefault();
    run(async () => {
      await login(username, password);
      await onDone();
    });
  }

  return (
    <GateShell>
      <h2 style={headingStyle}>Sign in to LEARNEX ERP</h2>
      {notice && <p style={{ ...bodyStyle, color: "#b45309" }}>{notice}</p>}
      <form onSubmit={submit}>
        <GateField
          label="Username or email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <GateField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p style={errorStyle}>{error}</p>}
        <button type="submit" style={buttonStyle} disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
      <p style={{ ...bodyStyle, margin: "16px 0 0", fontSize: 12, textAlign: "center" }}>
        Forgot your password? Ask the owner or an administrator to reset it.
      </p>
    </GateShell>
  );
}

/** After signing in with a one-time password, the user must choose their own. */
export function ForcedPasswordChangeScreen({ user, onDone, onSignOut }) {
  return (
    <GateShell>
      <h2 style={headingStyle}>Choose your own password</h2>
      <p style={bodyStyle}>
        Welcome, {user.name}. You signed in with a one-time password — choose a password only you know before
        continuing.
      </p>
      <PasswordChangeForm
        onDone={onDone}
        currentLabel="One-time password"
        submitLabel="Save Password & Continue"
      />
      <button style={linkStyle} onClick={onSignOut}>
        Sign out
      </button>
    </GateShell>
  );
}

export function PasswordChangeForm({
  onDone,
  currentLabel = "Current password",
  submitLabel = "Change Password",
}) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const { busy, error, setError, run } = usePending();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError("The two new passwords don't match.");
    run(async () => {
      await changePassword(form.current, form.next);
      await onDone();
    });
  }
  return (
    <form onSubmit={submit}>
      <GateField
        label={currentLabel}
        type="password"
        value={form.current}
        onChange={set("current")}
        autoComplete="current-password"
        required
      />
      <GateField
        label="New password"
        type="password"
        value={form.next}
        onChange={set("next")}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD} characters.`}
        required
      />
      <GateField
        label="Repeat new password"
        type="password"
        value={form.confirm}
        onChange={set("confirm")}
        autoComplete="new-password"
        required
      />
      {error && <p style={errorStyle}>{error}</p>}
      <button type="submit" style={buttonStyle} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
