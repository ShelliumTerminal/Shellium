import { useEffect, useState } from "react";
import type { AnimationEvent, CSSProperties } from "react";
import { BRAND_WORDMARK_PATH } from "../common/BrandMark";

type BrandStageProps = {
  /** Play the handshake once (Options › General › Animate the password screen); false shows the last
   * frame; null = settings not loaded yet, wait. */
  animate: boolean | null;
};

/** A few lines of an SSH handshake (decorative), the last one in the Aurora cyan. */
const HANDSHAKE: Array<{ text: string; tone?: "fp" | "ok" }> = [
  { text: "Connecting to shellium ..." },
  { text: "kex: curve25519-sha256" },
  { text: "host key: ssh-ed25519 SHA256:aU/r0Ra+x7c…", tone: "fp" },
  { text: "cipher: chacha20-poly1305@openssh.com" },
  { text: "✓ authenticated", tone: "ok" },
];

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Left half of the password screen (brand-stage.css, ss-*): a short SSH handshake runs by in mono,
 * then the session "opens" onto the Shellium wordmark over an aurora rule. It never delays anything -
 * the form beside it works from the first frame. The CSS without `.ss-run` is the last frame; once
 * the run ends the class goes, so nothing stays on an animated (composited) layer.
 */
export default function BrandStage({ animate }: BrandStageProps) {
  const [mode, setMode] = useState<"wait" | "run" | "done">("wait");

  useEffect(() => {
    if (mode === "wait" && animate !== null) {
      setMode(animate && !reducedMotion ? "run" : "done");
    }
  }, [animate, mode]);

  const handleAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName === "ss-tagline-in") {
      setMode("done");
    }
  };

  return (
    <section
      className={`lk-stage ss-${mode}`}
      aria-hidden="true"
      onAnimationEnd={mode === "run" ? handleAnimationEnd : undefined}
    >
      <div className="ss-brand">
        <div className="ss-log">
          {HANDSHAKE.map((line, index) => (
            <div key={line.text} className={line.tone ? `ss-${line.tone}` : undefined} style={{ "--ss-i": index } as CSSProperties}>
              {line.text}
            </div>
          ))}
        </div>
        <svg className="ss-word" viewBox="-1 14.55 259.13 51.22" shapeRendering="geometricPrecision">
          <defs>
            <linearGradient id="ss-satin" x1="0" y1="15" x2="0" y2="65" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.55" stopColor="#eef0f5" />
              <stop offset="1" stopColor="#d3d7e1" />
            </linearGradient>
          </defs>
          <path d={BRAND_WORDMARK_PATH} fill="url(#ss-satin)" />
        </svg>
        <div className="ss-rule" />
        <div className="ss-tagline">SSH workspace for production teams</div>
      </div>
      <div className="ss-foot">Version {__APP_VERSION__}</div>
    </section>
  );
}
