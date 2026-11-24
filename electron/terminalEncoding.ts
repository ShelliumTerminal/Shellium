import { StringDecoder } from "node:string_decoder";
import { DEFAULT_TERMINAL_ENCODING } from "../src/components/common/hostTerminalModel";
import type { TerminalEncoding } from "../src/components/common/hostTerminalModel";

export type TerminalDecoder = {
  /** Text of the next bytes; an incomplete multi-byte character waits for the rest. */
  write(data: Buffer): string;
  end(): string;
};

/** Decodes the shell's bytes in the host's character set. */
export function createTerminalDecoder(encoding: TerminalEncoding = DEFAULT_TERMINAL_ENCODING): TerminalDecoder {
  if (encoding === "utf-8") {
    // a character split across two packets must not turn into two U+FFFD
    const decoder = new StringDecoder("utf8");
    return { write: (data) => decoder.write(data), end: () => decoder.end() };
  }
  const decoder = new TextDecoder(encoding);
  return { write: (data) => decoder.decode(data, { stream: true }), end: () => decoder.decode() };
}

const encodeTables = new Map<TerminalEncoding, Map<string, number>>();

/** Character -> byte of a single-byte set, built by decoding all 256 bytes once. */
function encodeTable(encoding: TerminalEncoding) {
  let table = encodeTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let byte = 0; byte < 256; byte += 1) {
      const char = decoder.decode(Uint8Array.of(byte));
      if (char !== "�" && !table.has(char)) {
        table.set(char, byte);
      }
    }
    encodeTables.set(encoding, table);
  }
  return table;
}

/**
 * What the shell receives for `text` (typed keys, pasted text, commands): UTF-8 as it is, or the bytes
 * of the host's single-byte set. A character that set does not have is sent as "?".
 */
export function encodeForTerminal(text: string, encoding: TerminalEncoding = DEFAULT_TERMINAL_ENCODING): string | Buffer {
  if (encoding === "utf-8") {
    return text;
  }
  const table = encodeTable(encoding);
  const bytes: number[] = [];
  for (const char of text) {
    bytes.push(table.get(char) ?? 0x3f);
  }
  return Buffer.from(bytes);
}
