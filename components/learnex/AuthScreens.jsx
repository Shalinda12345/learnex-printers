import { useState } from "react";
import { changePassword, login, loginWithCode, registerOwner } from "@/lib/learnex/auth-client";
import {
  GateButton,
  GateError,
  GateField,
  GateHeading,
  GateLink,
  GateNotice,
  GateShell,
  GateText,
} from "@/components/learnex/gate";
import { KeyRound, Lock, ShieldCheck } from "@/components/learnex/icons";

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
        <GateHeading icon={ShieldCheck}>Create the owner account</GateHeading>
        <GateText>
          No accounts exist yet. To create the first (owner) account, the server needs a setup code: add a
          line
          <b> AUTH_SETUP_CODE=…</b> with a long secret value to the server&apos;s .env file and restart it.
        </GateText>
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
    <GateShell wide>
      <GateHeading icon={ShieldCheck}>Create the owner account</GateHeading>
      <GateText>
        This is the first account. The owner can do everything, including adding staff accounts and choosing
        what each person may do. You&apos;ll find the setup code in the server&apos;s .env file
        (AUTH_SETUP_CODE).
      </GateText>
      <form onSubmit={submit}>
        <GateField
          label="Setup code"
          value={form.setupCode}
          onChange={set("setupCode")}
          autoComplete="off"
          required
        />
        <div className="grid sm:grid-cols-2 gap-x-4">
          <GateField label="Your name" value={form.name} onChange={set("name")} autoComplete="name" required />
          <GateField
            label="Username"
            value={form.username}
            onChange={set("username")}
            autoComplete="username"
            hint="Used to sign in, e.g. “aarav”."
            required
          />
        </div>
        <GateField
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={set("email")}
          autoComplete="email"
        />
        <div className="grid sm:grid-cols-2 gap-x-4">
          <GateField
            label="Password"
            type="password"
            value={form.password}
            onChange={set("password")}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            meter
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
        </div>
        <GateError>{error}</GateError>
        <GateButton type="submit" busy={busy}>
          {busy ? "Creating…" : "Create Owner Account"}
        </GateButton>
      </form>
    </GateShell>
  );
}

export function LoginScreen({ onDone, notice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = usePending();
  // Two-step sign-in: after the password the account asks for the code from its authenticator app.
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState("");

  function submit(e) {
    e.preventDefault();
    run(async () => {
      if (ticket) {
        await loginWithCode(ticket, code);
        await onDone();
        return;
      }
      const result = await login(username, password);
      if (result && result.mfaRequired) {
        setTicket(result.ticket);
        return;
      }
      await onDone();
    });
  }

  if (ticket) {
    return (
      <GateShell>
        <GateHeading icon={ShieldCheck}>Enter your code</GateHeading>
        <GateText>Open your authenticator app and type the 6-digit code for LEARNEX ERP. Lost your phone? Use one of your recovery codes.</GateText>
        <form onSubmit={submit}>
          <GateField
            label="Authenticator or recovery code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            required
          />
          <GateError>{error}</GateError>
          <GateButton type="submit" busy={busy}>
            {busy ? "Checking…" : "Sign In"}
          </GateButton>
        </form>
        <GateLink
          onClick={() => {
            setTicket(null);
            setCode("");
          }}
        >
          Back
        </GateLink>
      </GateShell>
    );
  }

  return (
    <GateShell>
      <GateHeading>Sign in to LEARNEX ERP</GateHeading>
      <GateText>Welcome back — enter your details to continue.</GateText>
      {notice && <GateNotice>{notice}</GateNotice>}
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
        <GateError>{error}</GateError>
        <GateButton type="submit" busy={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </GateButton>
      </form>
      <p className="mt-5 text-xs text-center text-slate-500 flex items-center justify-center gap-1.5">
        <Lock size={12} className="shrink-0" />
        Forgot your password? Ask the owner or an administrator to reset it.
      </p>
    </GateShell>
  );
}

/** After signing in with a one-time password, the user must choose their own. */
export function ForcedPasswordChangeScreen({ user, onDone, onSignOut }) {
  return (
    <GateShell>
      <GateHeading icon={KeyRound}>Choose your own password</GateHeading>
      <GateText>
        Welcome, {user.name}. You signed in with a one-time password — choose a password only you know before
        continuing.
      </GateText>
      <PasswordChangeForm
        onDone={onDone}
        currentLabel="One-time password"
        submitLabel="Save Password & Continue"
      />
      <GateLink onClick={onSignOut}>Sign out</GateLink>
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
        meter
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
      <GateError>{error}</GateError>
      <GateButton type="submit" busy={busy}>
        {busy ? "Saving…" : submitLabel}
      </GateButton>
    </form>
  );
}
