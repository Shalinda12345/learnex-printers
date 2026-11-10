import { useEffect, useState } from "react";
import { Field, Modal, inputCls } from "@/components/learnex/ui";
import { getMfa, reauthenticate } from "@/lib/learnex/auth-client";
import { hasFreshReauth, setReauth } from "@/lib/learnex/persistence";

/* =====================================================================
   "Type your password again" — before restoring a backup, clearing a module or the factory reset.
   `const { ask, dialog } = useReauth(theme)`; `if (!(await ask("restore a backup"))) return;`
   and render `{dialog}`. A confirmation stays valid for five minutes (server side), so doing
   several of these in a row asks only once.
===================================================================== */
export function useReauth(theme) {
  const [asking, setAsking] = useState(null); // { what, resolve }
  const ask = (what) =>
    hasFreshReauth() ? Promise.resolve(true) : new Promise((resolve) => setAsking({ what, resolve }));
  const finish = (ok) => {
    asking.resolve(ok);
    setAsking(null);
  };
  const dialog = asking ? <ReauthModal what={asking.what} onDone={finish} {...theme} /> : null;
  return { ask, dialog };
}

function ReauthModal({ what, onDone, cardBg, dark, subText, inputBg }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getMfa()
      .then((m) => live && setNeedsCode(!!m.enabled))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { token, expiresAt } = await reauthenticate(password, needsCode ? code : undefined);
      setReauth(token, expiresAt);
      onDone(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Confirm it's you" onClose={() => onDone(false)} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <p className={`text-sm ${subText}`}>
          To {what}, type your password again. This can&apos;t be undone, so it is checked every time.
        </p>
        <Field label="Your password" subText={subText} error={error && !needsCode ? error : undefined}>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full ${inputCls(inputBg)}`}
          />
        </Field>
        {needsCode && (
          <Field label="Authenticator code" subText={subText} hint="The 6-digit code from your app, or a recovery code." error={error || undefined}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`w-full ${inputCls(inputBg)}`}
            />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
