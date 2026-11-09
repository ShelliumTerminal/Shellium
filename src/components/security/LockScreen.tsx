import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import type { SecurityState } from "../../app/useSecurity";
import { useEscapeLayer } from "../../app/escapeLayers";
import BrandMark from "../common/BrandMark";
import BrandStage from "./BrandStage";

/** Full-window screen to create the application password or unlock Shellium: the brand stage on the
 * left, the form on the right (a band on top in a narrow window). */
export default function LockScreen({ security, animateBrand }: { security: SecurityState; animateBrand: boolean | null }) {
  // Swallows Escape: windows opened before the lock stay put underneath, and nothing here quits.
  useEscapeLayer(() => undefined);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  // macOS / Linux may show their own Keychain / keyring prompt while Shellium sets up or unlocks; the
  // main process waits for it, so tell the user where to look. Windows (DPAPI) never asks.
  const keyringHint = window.shellium?.app.platform === "darwin"
    ? "If macOS asks for Keychain access, allow it to continue."
    : window.shellium?.app.platform === "linux"
      ? "If your keyring asks to be unlocked, answer it to continue."
      : null;
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!security.isBusy) {
      setIsSlow(false);
      return;
    }
    // Only when the wait is noticeable - a normal unlock takes a fraction of a second.
    const timer = window.setTimeout(() => setIsSlow(true), 700);
    return () => window.clearTimeout(timer);
  }, [security.isBusy]);

  const isSubmitDisabled = security.isBusy || security.isStatusLoading || security.password.length < 8
    || (security.isSetupRequired && security.password !== security.confirmPassword);

  return (
    <section className="lk-screen" aria-label="Application password">
      <BrandStage animate={animateBrand} />
      <div className="lk-panel">
        <div className="lk-top">
          <BrandMark size={28} blink />
          <span className="lk-top-name">Shellium</span>
          <span className="lk-top-state">{security.isSetupRequired ? "First start" : "Locked"}</span>
        </div>
        <form
          className="lk-form"
          onSubmit={(event) => {
            event.preventDefault();
    
            if (isSubmitDisabled) {
              return;
            }
    
            if (security.isSetupRequired) {
              security.setup();
              return;
            }
    
            if (security.isLocked) {
              security.unlock();
            }
          }}
        >
          <header className="lk-header">
            <h1>{security.isSetupRequired ? "Create an application password" : "Welcome back"}</h1>
            <p>
              {security.isSetupRequired
                ? "It encrypts your saved hosts, credentials and scripts on this device. There is no way to recover it if you forget it."
                : "Enter your application password to unlock your hosts, credentials and scripts."}
            </p>
          </header>
          {security.isStatusLoading ? (
            <div className="lk-loading">Loading security status...</div>
          ) : (
            <>
              <div className="lk-fields">
                <label className="lk-field">
                  <span>{security.isSetupRequired ? "New password" : "Application password"}</span>
                  <div className="lk-input">
                    <KeyRound size={15} aria-hidden="true" />
                    <input
                      type={isPasswordVisible ? "text" : "password"}
                      value={security.password}
                      autoFocus
                      autoComplete={security.isSetupRequired ? "new-password" : "current-password"}
                      aria-invalid={Boolean(security.error)}
                      onChange={(event) => security.setPassword(event.target.value)}
                      onKeyDown={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      onKeyUp={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                    />
                    <button
                      className="lk-eye"
                      type="button"
                      title={isPasswordVisible ? "Hide password" : "Show password"}
                      aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                      onClick={() => setIsPasswordVisible((current) => !current)}
                    >
                      {isPasswordVisible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
                    </button>
                  </div>
                </label>
                {security.isSetupRequired && (
                  <label className="lk-field">
                    <span>Confirm password</span>
                    <div className="lk-input">
                      <KeyRound size={15} aria-hidden="true" />
                      <input
                        type={isPasswordVisible ? "text" : "password"}
                        value={security.confirmPassword}
                        autoComplete="new-password"
                        onChange={(event) => security.setConfirmPassword(event.target.value)}
                        onKeyDown={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                        onKeyUp={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      />
                    </div>
                  </label>
                )}
                {security.isSetupRequired && (
                  <ul className="lk-rules">
                    <li className={security.password.length >= 8 ? "is-met" : ""}>At least 8 characters</li>
                    <li className={security.password.length > 0 && security.password === security.confirmPassword ? "is-met" : ""}>Both entries match</li>
                  </ul>
                )}
                {isCapsLockOn && <div className="lk-hint">Caps Lock is on</div>}
                {security.isBusy && isSlow && keyringHint && <div className="lk-hint" role="status">{keyringHint}</div>}
                {security.error && <div className="lk-error" role="alert">{security.error}</div>}
              </div>
              <button className="sh-btn sh-btn-primary lk-submit" type="submit" disabled={isSubmitDisabled}>
                {security.isBusy ? "Working..." : security.isSetupRequired ? "Create password" : "Unlock"}
              </button>
            </>
          )}
        </form>
        <footer className="lk-footer">
          <span>
            <ShieldCheck size={14} aria-hidden="true" />
            Encrypted on this device · AES-256-GCM
          </span>
          <button type="button" className="lk-quit" onClick={() => window.close()}>
            Quit Shellium
          </button>
        </footer>
      </div>
    </section>
  );
}
