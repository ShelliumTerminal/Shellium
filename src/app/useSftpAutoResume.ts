import { useEffect, useRef } from "react";
import type { Session } from "../components/palette/types";
import { withSftpConnection } from "../components/files/sftpConnection";

/**
 * Options > General > "Resume transfers after reconnecting": when a session that was disconnected is
 * connected again (Reconnect), its SFTP transfers that a lost connection paused continue. Transfers
 * the user paused (pausedBy "user") stay paused. Nothing happens without a reconnect: there is no
 * automatic reconnect (owner's decision), the user's Reconnect is the signal that the link is back.
 */
export function useSftpAutoResume(sessions: Session[], enabled: boolean) {
  const droppedRef = useRef(new Set<string>());

  useEffect(() => {
    const api = window.shellium?.sftp;
    const dropped = droppedRef.current;
    const open = new Set(sessions.map((session) => session.id));
    dropped.forEach((id) => {
      if (!open.has(id)) {
        dropped.delete(id);
      }
    });

    sessions.forEach((session) => {
      if (session.status === "disconnected") {
        dropped.add(session.id);
        return;
      }
      if (session.status !== "connected" || !dropped.has(session.id)) {
        return;
      }
      dropped.delete(session.id);
      if (!enabled || !api) {
        return;
      }
      void (async () => {
        const jobs = await api.listJobs(session.id).catch(() => []);
        const lost = jobs
          .filter((job) => job.status === "paused" && job.pausedBy === "connection")
          .sort((a, b) => a.createdAt - b.createdAt);
        for (const job of lost) {
          // A failure leaves the job paused with its message; Start in the queue still works.
          await withSftpConnection(session, () => api.resumeJob(job.id)).catch(() => undefined);
        }
      })();
    });
  }, [sessions, enabled]);
}
