import { useEffect, useState } from "react";

export type SecurityStatus = {
  enabled: boolean;
  unlocked: boolean;
};

/** ipcRenderer.invoke wraps main-process errors as "Error invoking remote method 'x': Error: <message>". */
export function ipcErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "") || fallback;
}

/**
 * The application password: status, the password fields shared by the lock screen and
 * Options > Security, and setup / unlock / lock. `onUnlocked` runs after setup or unlock so the
 * caller reloads the (now readable) data.
 */
export function useSecurity(storageRevision: number, onUnlocked: () => void) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;

    window.shellium?.security.status()
      .then((nextStatus) => {
        if (isMounted) {
          setStatus(nextStatus);
        }
      })
      .catch((statusError: unknown) => {
        if (isMounted) {
          setError(statusError instanceof Error ? statusError.message : "Security status could not be loaded.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [storageRevision]);

  const isStatusLoading = status === null;
  const isSetupRequired = Boolean(status && !status.enabled);
  const isLocked = Boolean(status?.enabled && !status.unlocked);
  const canUseSecureData = status !== null && status.enabled && status.unlocked;

  const setup = () => {
    setError(null);
    setNotice(null);

    if (isBusy) {
      return;
    }

    if (password.length < 8) {
      setError("Master password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Master password confirmation does not match.");
      return;
    }

    setIsBusy(true);
    window.shellium?.security.setup(password)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setPassword("");
        setConfirmPassword("");
        onUnlocked();
        setNotice("Login created. Shellium data is encrypted with this password and a key bound to your user account on this computer.");
      })
      .catch((setupError: unknown) => {
        setError(ipcErrorMessage(setupError, "Security could not be enabled."));
      })
      .finally(() => setIsBusy(false));
  };

  const unlock = () => {
    setError(null);
    setNotice(null);

    if (isBusy) {
      return;
    }

    if (password.length < 8) {
      setError("Master password must be at least 8 characters.");
      return;
    }

    setIsBusy(true);
    window.shellium?.security.unlock(password)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setPassword("");
        onUnlocked();
        setNotice("Login accepted. Shellium data unlocked.");
      })
      .catch((unlockError: unknown) => {
        setError(ipcErrorMessage(unlockError, "Security could not be unlocked."));
      })
      .finally(() => setIsBusy(false));
  };

  const lock = () => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    window.shellium?.security.lock()
      .then((nextStatus) => {
        setStatus(nextStatus);
        setNotice("Security locked.");
      })
      .catch((lockError: unknown) => {
        setError(ipcErrorMessage(lockError, "Security could not be locked."));
      })
      .finally(() => setIsBusy(false));
  };

  return {
    status,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    notice,
    isBusy,
    isStatusLoading,
    isSetupRequired,
    isLocked,
    canUseSecureData,
    setup,
    unlock,
    lock,
  };
}

export type SecurityState = ReturnType<typeof useSecurity>;
