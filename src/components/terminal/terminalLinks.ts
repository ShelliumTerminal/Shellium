/**
 * Links in terminal output, opened with Ctrl+click (Cmd+click on a Mac):
 * - web addresses (http / https) open in the default browser;
 * - absolute paths (/u01/app/oracle/diag/.../alert_ORCL.log) open in the session's SFTP view: a folder
 *   is shown, a file is selected in its folder.
 * Positions are string indexes into the text of one logical line (wrapped rows joined); end is exclusive.
 */
export type TerminalLink = {
  kind: "url" | "path";
  text: string;
  start: number;
  end: number;
};

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/gu;
// A path starts at a "/" that does not follow a letter, digit, ".", "/", "~" or "-": "and/or",
// "1/2", "x.com/a" and the "//" of a URL are not paths. "@/home/oracle/x.sql" and "host:/u01" are.
const PATH_PATTERN = /(?<![\p{L}\p{N}_./~-])(?:\/[\p{L}\p{N}_.%+~-]+)+\/?/gu;
const TRAILING_PUNCTUATION = /[.,;:!?'"]$/u;

/** Drops what ends a sentence rather than the link; a closing bracket stays when the link opened it. */
function trimLinkEnd(text: string) {
  let result = text;

  for (;;) {
    if (TRAILING_PUNCTUATION.test(result)) {
      result = result.slice(0, -1);
      continue;
    }

    const last = result[result.length - 1];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const open = last ? pairs[last] : undefined;

    if (open && result.split(open).length - 1 < result.split(last as string).length - 1) {
      result = result.slice(0, -1);
      continue;
    }

    return result;
  }
}

export function findTerminalLinks(text: string): TerminalLink[] {
  const links: TerminalLink[] = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    const linkText = trimLinkEnd(match[0]);
    const start = match.index ?? 0;

    if (linkText.length > "https://".length) {
      links.push({ kind: "url", text: linkText, start, end: start + linkText.length });
    }
  }

  for (const match of text.matchAll(PATH_PATTERN)) {
    const start = match.index ?? 0;
    const linkText = trimLinkEnd(match[0]);
    const end = start + linkText.length;

    if (linkText.length < 2 || links.some((link) => link.kind === "url" && start < link.end && end > link.start)) {
      continue;
    }

    links.push({ kind: "path", text: linkText, start, end });
  }

  return links.sort((a, b) => a.start - b.start);
}

/** The folder of a remote (POSIX) path and the last part of it. */
export function splitRemotePath(remotePath: string) {
  const trimmed = remotePath.length > 1 ? remotePath.replace(/\/+$/, "") : remotePath;
  const slash = trimmed.lastIndexOf("/");

  return {
    folder: slash <= 0 ? "/" : trimmed.slice(0, slash),
    name: trimmed.slice(slash + 1),
    path: trimmed,
  };
}
