import { useEffect, useState } from "react";
import { Badge, Field, Modal, inputCls } from "@/components/learnex/ui";
import { disableMfa, finishMfaSetup, getMfa, startMfaSetup } from "@/lib/learnex/auth-client";

/* =====================================================================
   Two-step sign-in, for the signed-in person: switch it on with an authenticator app,
   see how many recovery codes are left, or switch it off. Opened from the account menu.
===================================================================== */
export function TwoStepDialog({ onClose, cardBg, dark, subText, inputBg }) {
  const [state, setState] = useState(null); // { available, enabled, recoveryCodesLeft }
  const [step, setStep] = useState("home"); // home | password | scan | codes | off
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null); // { secret, uri }
  const [recovery, setRecovery] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    getMfa()
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

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

  const themed = { subText };
  const input = (props) => <input {...props} className={`w-full ${inputCls(inputBg)}`} />;

  let body;
  if (!state) body = <p className={`text-sm ${subText}`}>{error || "Loading…"}</p>;
  else if (step === "codes")
    body = (
      <div className="space-y-4">
        <p className="text-sm">
          Two-step sign-in is <b>on</b>. Save these recovery codes somewhere safe (a password manager, or on paper).
          Each one works once if you lose your phone. <b>They are shown only now.</b>
        </p>
        <pre className={`rounded-xl border p-3 text-sm font-mono leading-7 ${dark ? "border-slate-700" : "border-slate-200 bg-slate-50"}`} data-testid="recovery-codes">
          {recovery.join("\n")}
        </pre>
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={onClose}>
            I&apos;ve saved them
          </button>
        </div>
      </div>
    );
  else if (step === "scan")
    body = (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await finishMfaSetup(code);
            setRecovery(r.recoveryCodes);
            setStep("codes");
          });
        }}
      >
        <p className={`text-sm ${subText}`}>
          In your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) choose
          &ldquo;add account&rdquo; → &ldquo;enter a setup key&rdquo;, and type this key:
        </p>
        <p className="font-mono text-base tracking-wider select-all break-all" data-testid="mfa-secret">
          {setup.secret.match(/.{1,4}/g).join(" ")}
        </p>
        <p className={`text-xs ${subText}`}>
          On a phone you can also{" "}
          <a className="text-blue-600 underline" href={setup.uri}>
            open it directly in the app
          </a>
          . Then type the 6-digit code the app shows:
        </p>
        <Field label="Code from the app" {...themed} error={error || undefined}>
          {input({ inputMode: "numeric", autoComplete: "one-time-code", required: true, value: code, onChange: (e) => setCode(e.target.value) })}
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Checking…" : "Switch on"}
          </button>
        </div>
      </form>
    );
  else if (step === "password" || step === "off")
    body = (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (step === "password") {
              setSetup(await startMfaSetup(password));
              setCode("");
              setStep("scan");
            } else {
              await disableMfa(password, code);
              setPassword("");
              setCode("");
              await refresh();
              setStep("home");
            }
          });
        }}
      >
        <p className={`text-sm ${subText}`}>
          {step === "password"
            ? "Type your password to start."
            : "To switch it off, type your password and a current code (or a recovery code)."}
        </p>
        <Field label="Your password" {...themed} error={step === "password" ? error || undefined : undefined}>
          {input({ type: "password", autoComplete: "current-password", required: true, value: password, onChange: (e) => setPassword(e.target.value) })}
        </Field>
        {step === "off" && (
          <Field label="Authenticator code" {...themed} error={error || undefined}>
            {input({ inputMode: "numeric", autoComplete: "one-time-code", required: true, value: code, onChange: (e) => setCode(e.target.value) })}
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => { setError(""); setStep("home"); }}>
            Back
          </button>
          <button className={`btn ${step === "off" ? "btn-danger" : "btn-primary"}`} disabled={busy}>
            {busy ? "Please wait…" : step === "off" ? "Switch off" : "Continue"}
          </button>
        </div>
      </form>
    );
  else
    body = (
      <div className="space-y-4">
        <p className={`text-sm ${subText}`}>
          Besides your password, sign-in asks for a 6-digit code from an app on your phone. Even if someone learns
          your password, they cannot sign in as you.
        </p>
        <p className="text-sm flex items-center gap-2">
          Status: {state.enabled ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}
          {state.enabled && <span className={`text-xs ${subText}`}>{state.recoveryCodesLeft} recovery code(s) left</span>}
        </p>
        {!state.available && !state.enabled && (
          <p className="text-sm text-amber-600">
            This server isn&apos;t set up for it yet: the administrator needs to add AUTH_MFA_KEY to the server&apos;s settings.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {state.enabled ? (
            <button className="btn btn-danger" onClick={() => { setError(""); setStep("off"); }}>
              Switch off
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!state.available} onClick={() => { setError(""); setStep("password"); }}>
              Set up
            </button>
          )}
        </div>
      </div>
    );

  return (
    <Modal title="Two-step sign-in" onClose={onClose} cardBg={cardBg} dark={dark}>
      {body}
    </Modal>
  );
}
