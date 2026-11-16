import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronUp, Copy } from "lucide-react";
import { EnvironmentBadge } from "../common/environments";
import type { Session } from "../palette/types";
import { getSessionTitle } from "../../app/sessionModel";
import { useEscapeLayer } from "../../app/escapeLayers";

/** How long "Copied" stays on a part / a check mark on a card row. */
const COPIED_MS = 1400;

type CopyKey = "user" | "host" | "port" | "ssh";

/** `ssh [-p port] [user@]host`, the way to open the same session from any shell. */
function sshCommand(host: Session["host"]) {
  const port = host.port || 22;
  return `ssh ${port === 22 ? "" : `-p ${port} `}${host.username ? `${host.username}@` : ""}${host.hostname}`;
}

/**
 * user@host:port in the status bar. Each part copies itself on a click ("Copied" for a moment); the
 * arrow (or a right-click) opens a card with every part and the ssh command, each with a copy button.
 */
export default function StatusEndpoint({ session }: { session: Session }) {
  const { host } = session;
  const port = String(host.port || 22);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<CopyKey | null>(null);
  const [card, setCard] = useState<{ left: number; bottom: number; root: Element } | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const closeCard = () => setCard(null);
  useEscapeLayer(closeCard, Boolean(card));

  useEffect(() => {
    if (!card) {
      return;
    }
    // capture phase: the terminal stops pointer events on the document before they bubble
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (cardRef.current?.contains(target) || anchorRef.current?.contains(target))) {
        return;
      }
      setCard(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("blur", closeCard);
    window.addEventListener("resize", closeCard);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("blur", closeCard);
      window.removeEventListener("resize", closeCard);
    };
  }, [card]);

  useEffect(() => {
    setCard(null);
    setCopied(null);
  }, [session.id]);

  useEffect(() => () => {
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
  }, []);

  const copy = (key: CopyKey, text: string) => {
    void window.shellium?.clipboard.writeText(text).then(() => {
      setCopied(key);
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
    }).catch(() => undefined);
  };

  const toggleCard = () => {
    const anchor = anchorRef.current;
    // portalled to the shell: the status bar is a size container and would clip a fixed popup
    const root = anchor?.closest(".shellium-shell");
    if (card || !anchor || !root) {
      setCard(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setCard({ left: Math.max(8, rect.left - 8), bottom: window.innerHeight - rect.top + 6, root });
  };

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!card) {
      toggleCard();
    }
  };

  const part = (key: CopyKey, value: string, label: string) => (
    <button
      type="button"
      className={`sh-endpoint-part${copied === key ? " copied" : ""}`}
      title={`Copy ${label}`}
      onClick={() => copy(key, value)}
    >
      {value}
      {copied === key && <span className="sh-endpoint-toast" role="status">Copied</span>}
    </button>
  );

  const rows: Array<{ key: CopyKey; label: string; value: string }> = [
    { key: "host", label: "Hostname", value: host.hostname },
    ...(host.username ? [{ key: "user" as const, label: "Username", value: host.username }] : []),
    { key: "port", label: "Port", value: port },
    { key: "ssh", label: "SSH", value: sshCommand(host) },
  ];

  return (
    <span className="sh-status-item sh-status-endpoint" ref={anchorRef} onContextMenu={handleContextMenu}>
      {host.username && <>{part("user", host.username, "user name")}<span className="sh-endpoint-sep">@</span></>}
      {part("host", host.hostname, "host name")}
      <span className="sh-endpoint-sep">:</span>
      {part("port", port, "port")}
      <button
        type="button"
        className={`sh-endpoint-more${card ? " open" : ""}`}
        aria-label="Connection details"
        aria-expanded={Boolean(card)}
        title="Connection details"
        onClick={toggleCard}
      >
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      {card && createPortal(
        <div
          className="sh-endpoint-card"
          ref={cardRef}
          role="dialog"
          aria-label="Connection details"
          style={{ left: card.left, bottom: card.bottom }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="sh-endpoint-card-head">
            <span className="sh-endpoint-card-title" title={getSessionTitle(session)}>{getSessionTitle(session)}</span>
            <EnvironmentBadge environmentId={host.environmentId} />
          </div>
          {rows.map((row) => (
            <div className="sh-endpoint-row" key={row.key}>
              <span className="sh-endpoint-label">{row.label}</span>
              <span className="sh-endpoint-value" title={row.value}>{row.value}</span>
              <button
                type="button"
                className={`sh-endpoint-copy${copied === row.key ? " copied" : ""}`}
                aria-label={`Copy ${row.label}`}
                title={copied === row.key ? "Copied" : `Copy ${row.label}`}
                onClick={() => copy(row.key, row.value)}
              >
                {copied === row.key ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              </button>
            </div>
          ))}
        </div>,
        card.root,
      )}
    </span>
  );
}
