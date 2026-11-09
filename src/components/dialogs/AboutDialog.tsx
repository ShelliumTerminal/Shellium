import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import BrandMark, { BrandWordmark } from "../common/BrandMark";
import { clampCloseConfirmFrame, createDefaultCloseConfirmFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import { useEscapeLayer } from "../../app/escapeLayers";

/** Help > About Shellium: the version (from package.json at build time) and the runtime under it. */
export default function AboutDialog({ onClose }: { onClose(): void }) {
  useEscapeLayer(onClose);
  const { frame, onHeaderPointerDown } = useDialogFrame(createDefaultCloseConfirmFrame, clampCloseConfirmFrame);
  const [copied, setCopied] = useState(false);
  const versions = window.shellium?.app.versions;
  const rows: [string, string][] = [
    ["Version", __APP_VERSION__],
    ["Electron", versions?.electron ?? "-"],
    ["Chromium", versions?.chrome ?? "-"],
    ["Node.js", versions?.node ?? "-"],
    ["Platform", `${window.shellium?.app.platform ?? "-"} ${versions?.arch ?? ""}`.trim()],
  ];

  const copyInfo = () => {
    const text = `Shellium ${rows.map(([key, value]) => `${key}: ${value}`).join(" · ")}`;
    void window.shellium?.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <section className="md-overlay md-overlay-confirm" aria-label="About Shellium">
      <div className="md-dialog ab-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" style={frameStyle(frame)}>
        <header className="md-header ab-header" onPointerDown={onHeaderPointerDown}>
          <BrandMark size={52} />
          <div className="md-title">
            <h2 id="about-title" className="ab-title">
              <BrandWordmark height={22} />
            </h2>
            <p>SSH workspace for production teams</p>
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">
          <dl className="ab-rows">
            {rows.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="ab-license">
            Free and open source under the MIT License. Provided &quot;as is&quot;, without warranty of any
            kind; the authors accept no liability. You use it at your own risk.
          </p>
        </div>
        <div className="md-actions">
          <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={copyInfo}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy version info"}
          </button>
          <button type="button" className="sh-btn sh-btn-primary" autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </section>
  );
}
