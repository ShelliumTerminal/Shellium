import type { CSSProperties } from "react";

/** Script buttons: the library model, colors and the SecureCRT-style send string format. */

export type ScriptButtonColor = "black" | "blue" | "cyan" | "green" | "grey" | "magenta" | "orange" | "purple" | "red" | "white" | "yellow";

export type ScriptButton = {
  id: string;
  categoryId: string;
  label: string;
  script: string;
  color: ScriptButtonColor;
  /** Show the send string as a tooltip on the script bar (off for buttons that type a password). */
  showTooltip: boolean;
  sortOrder: number;
};

export type ScriptButtonCategory = {
  id: string;
  name: string;
  sortOrder: number;
  buttons: ScriptButton[];
};

export type ScriptButtonLibrary = {
  categories: ScriptButtonCategory[];
};

export type ScriptButtonDraft = {
  label: string;
  script: string;
  color: ScriptButtonColor;
  showTooltip: boolean;
};

export type CategoryDraft = {
  name: string;
};
export const scriptButtonColorOptions: Array<{ value: ScriptButtonColor; label: string; color: string; border: string; highlight: string }> = [
  { value: "black", label: "Black", color: "#111827", border: "rgba(0, 0, 0, 0.82)", highlight: "rgba(255, 255, 255, 0.34)" },
  { value: "blue", label: "Blue", color: "#2563eb", border: "rgba(30, 64, 175, 0.78)", highlight: "rgba(219, 234, 254, 0.82)" },
  { value: "cyan", label: "Cyan", color: "#06b6d4", border: "rgba(14, 116, 144, 0.78)", highlight: "rgba(207, 250, 254, 0.86)" },
  { value: "green", label: "Green", color: "#22c55e", border: "rgba(7, 95, 37, 0.72)", highlight: "rgba(220, 252, 231, 0.82)" },
  { value: "grey", label: "Grey", color: "#94a3b8", border: "rgba(71, 85, 105, 0.72)", highlight: "rgba(248, 250, 252, 0.78)" },
  { value: "magenta", label: "Magenta", color: "#d946ef", border: "rgba(162, 28, 175, 0.74)", highlight: "rgba(250, 232, 255, 0.86)" },
  { value: "orange", label: "Orange", color: "#f97316", border: "rgba(194, 65, 12, 0.76)", highlight: "rgba(255, 237, 213, 0.86)" },
  { value: "purple", label: "Purple", color: "#8b5cf6", border: "rgba(109, 40, 217, 0.76)", highlight: "rgba(237, 233, 254, 0.84)" },
  { value: "red", label: "Red", color: "#ef4444", border: "rgba(185, 28, 28, 0.76)", highlight: "rgba(254, 226, 226, 0.84)" },
  { value: "white", label: "White", color: "#f8fafc", border: "rgba(148, 163, 184, 0.82)", highlight: "rgba(255, 255, 255, 0.92)" },
  { value: "yellow", label: "Yellow", color: "#eab308", border: "rgba(161, 98, 7, 0.76)", highlight: "rgba(254, 249, 195, 0.88)" },
];

export function normalizeScriptButtonColor(value: unknown): ScriptButtonColor {
  return scriptButtonColorOptions.some((option) => option.value === value) ? value as ScriptButtonColor : "green";
}

export function getScriptButtonStatusStyle(color: ScriptButtonColor): CSSProperties {
  const option = scriptButtonColorOptions.find((item) => item.value === color) ?? scriptButtonColorOptions[3];

  return {
    "--script-button-color": option.color,
    "--script-button-color-border": option.border,
    "--script-button-color-highlight": option.highlight,
  } as CSSProperties;
}

export function normalizeScriptButtonLibrary(value: unknown): ScriptButtonLibrary {
  const parsed = typeof value === "object" && value !== null ? value as Partial<ScriptButtonLibrary> : {};
  const categoryInput = Array.isArray(parsed.categories) ? parsed.categories : [];
  const categories = categoryInput.flatMap((item, categoryIndex): ScriptButtonCategory[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const category = item as Partial<ScriptButtonCategory>;
    const id = typeof category.id === "string" && category.id.trim() ? category.id : `script-category-${categoryIndex}`;
    const name = typeof category.name === "string" && category.name.trim() ? category.name.trim() : `Category ${categoryIndex + 1}`;
    const buttonInput = Array.isArray(category.buttons) ? category.buttons : [];

    return [{
      id,
      name,
      sortOrder: categoryIndex,
      buttons: buttonInput.flatMap((buttonItem, buttonIndex): ScriptButton[] => {
        if (typeof buttonItem !== "object" || buttonItem === null) {
          return [];
        }

        const button = buttonItem as Partial<ScriptButton>;
        const label = typeof button.label === "string" ? button.label.trim() : "";
        const script = typeof button.script === "string" ? button.script : "";

        if (!label || !script.trim()) {
          return [];
        }

        return [{
          id: typeof button.id === "string" && button.id.trim() ? button.id : `${id}-button-${buttonIndex}`,
          categoryId: id,
          label,
          script,
          color: normalizeScriptButtonColor(button.color),
          showTooltip: button.showTooltip !== false,
          sortOrder: buttonIndex,
        }];
      }),
    }];
  });

  return {
    categories: categories.length > 0 ? categories : [{ id: "default", name: "Default", sortOrder: 0, buttons: [] }],
  };
}

export function createScriptCategoryId() {
  return `script-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createScriptButtonId() {
  return `script-button-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function encodeLegacyScriptAsSendString(script: string) {
  return script
    .replace(/\r\n/g, "\\r")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\r");
}

type SendStringPart = { kind: "text"; value: string } | { kind: "pause" };

function parseSendString(sendString: string): SendStringPart[] {
  const parts: SendStringPart[] = [];
  let text = "";

  const flushText = () => {
    if (text) {
      parts.push({ kind: "text", value: text });
      text = "";
    }
  };

  for (let index = 0; index < sendString.length; index += 1) {
    const character = sendString[index];

    if (character !== "\\" || index === sendString.length - 1) {
      text += character;
      continue;
    }

    const token = sendString[index + 1]?.toLowerCase();
    index += 1;

    if (token === "r") {
      text += "\r";
    } else if (token === "n") {
      text += "\n";
    } else if (token === "t") {
      text += "\t";
    } else if (token === "b") {
      text += "\b";
    } else if (token === "e") {
      text += "\x1b";
    } else if (token === "p") {
      flushText();
      parts.push({ kind: "pause" });
    } else if (token === "\\") {
      text += "\\";
    } else {
      text += `\\${sendString[index]}`;
    }
  }

  flushText();
  return parts;
}

export function normalizeSendStringInput(value: string) {
  return encodeLegacyScriptAsSendString(value)
    .replace(/[ \t]*\\([rnpteb])[ \t]*/gi, "\\$1")
    .trimEnd();
}

export function prepareScriptForTerminal(script: string) {
  const isLegacyMultilineScript = /\r|\n/.test(script);
  const sendString = isLegacyMultilineScript
    ? `${encodeLegacyScriptAsSendString(script).trimEnd()}\\r`
    : normalizeSendStringInput(script);

  return parseSendString(sendString);
}
