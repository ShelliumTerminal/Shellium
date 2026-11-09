import type { Session } from "../palette/types";

/** Thrown by the main process when the session has no SFTP channel (never opened, closed or lost). */
const NOT_CONNECTED = "SFTP session is not connected";

export function isSftpNotConnected(error: unknown) {
  return String(error instanceof Error ? error.message : error).includes(NOT_CONNECTED);
}

/**
 * Runs an SFTP call; when the channel is gone - typically a dropped connection - connects again
 * once and retries. The main process reuses a live channel, so this never cuts a running transfer.
 */
export async function withSftpConnection<T>(session: Session, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const api = window.shellium?.sftp;
    if (!api || !isSftpNotConnected(error)) {
      throw error;
    }
    await api.connect({ sessionId: session.id, host: session.host });
    return run();
  }
}
