/**
 * Host lists from other tools' XML exports (SecureCRT, mRemoteNG, or any XML with host entries).
 *
 * There is no per-tool code: a small, strict XML reader turns the file into elements, every
 * element that carries a host-like value becomes a record with all its fields, and the user maps
 * fields to Shellium's (name, host, port, username, ...) in the import wizard. Known layouts only
 * pre-fill that mapping.
 *
 * Fields are collected in the three shapes tools use:
 *   attributes                     <Node Hostname="db01" Port="22"/>             (mRemoteNG)
 *   child elements with name=""    <string name="Hostname">db01</string>        (SecureCRT)
 *   plain child elements           <Host>db01</Host>
 * Folders come from the named elements around a record (<key name="Prod">, <Node Name="Prod">).
 *
 * The reader never resolves anything: a DOCTYPE / ENTITY is refused (no XXE, no entity
 * expansion), only the five XML entities and character references are decoded, and depth and
 * element count are bounded. Password-like fields are dropped while reading and never reach the
 * renderer or the import.
 */

export type XmlRecord = {
  /** Source field name -> value (trimmed). */
  fields: Record<string, string>;
  /** Folder names from the file's structure, outermost first. */
  path: string[];
  /** For messages: the record's own name or its first host value. */
  label: string;
};

export type XmlSource = {
  /** "SecureCRT", "mRemoteNG" or null for an unknown layout. */
  format: string | null;
  records: XmlRecord[];
};

export type MappingTarget = "name" | "host" | "port" | "username" | "description" | "tags" | "environment" | "protocol" | "folder";

type XmlElement = { name: string; attrs: [string, string][]; children: XmlElement[]; text: string };

const MAX_DEPTH = 100;
const MAX_ELEMENTS = 500_000;
const SECRET_FIELD = /pass|pwd|secret|private ?key|token/i;
const HOST_KEYS = ["hostname", "host", "address", "ipaddress", "ip", "server", "remotehost"];
const NAME_ATTRS = ["name", "title", "label"];
/** Wrapper folders a tool always writes around its sessions; not real folders of the user's. */
const WRAPPER_FOLDERS = new Set(["sessions"]);

/** Source field names Shellium suggests for each target, best first (compared without case / punctuation). */
const SUGGEST: Record<Exclude<MappingTarget, "folder">, string[]> = {
  host: HOST_KEYS,
  port: ["ssh2port", "sshport", "port"],
  username: ["username", "user", "login", "userid", "loginname"],
  name: ["name", "sessionname", "displayname", "label", "title"],
  description: ["description", "descr", "desc", "notes", "note", "comment", "comments"],
  tags: ["tags", "tag", "keywords"],
  environment: ["environment", "env"],
  protocol: ["protocolname", "protocol", "connectiontype"],
};

export const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

export function readXmlSource(raw: Buffer): XmlSource {
  const root = parseXml(decodeText(raw));
  if (root.children.length === 0 && root.text.trim().length > 64) {
    throw new Error("The file's content is encrypted. Export it again without encryption (in mRemoteNG: turn off \"Encrypt complete connection file\").");
  }

  const records: XmlRecord[] = [];
  const walk = (element: XmlElement, path: string[]) => {
    const fields = fieldsOf(element);
    const hostKey = Object.keys(fields).find((key) => HOST_KEYS.includes(normalizeKey(key)) && fields[key]);
    if (hostKey) {
      const own = ownName(element);
      records.push({ fields, path: path.filter((part, index) => index > 0 || !WRAPPER_FOLDERS.has(part.toLowerCase())), label: own || fields[hostKey] });
    }
    const name = ownName(element);
    element.children.forEach((child) => walk(child, hostKey || !name ? path : [...path, name]));
  };
  // The document element is the file itself (<VanDyke>, <Connections>), never a folder.
  root.children.forEach((child) => walk(child, []));

  if (records.length === 0) {
    throw new Error("No host entries were found in this XML file (no element has a Hostname, Host or Address value).");
  }
  return { format: detectFormat(root), records };
}

/** Field catalogue for the mapping step: how many records fill each field, and a few examples. */
export function describeFields(source: XmlSource) {
  const stats = new Map<string, { filled: number; samples: string[] }>();
  source.records.forEach((record) => {
    Object.entries(record.fields).forEach(([key, value]) => {
      const entry = stats.get(key) ?? { filled: 0, samples: [] };
      if (value) {
        entry.filled += 1;
        if (entry.samples.length < 3 && !entry.samples.includes(value)) entry.samples.push(value.length > 60 ? `${value.slice(0, 57)}...` : value);
      }
      stats.set(key, entry);
    });
  });
  return [...stats.entries()]
    .filter(([, entry]) => entry.filled > 0)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => b.filled - a.filled || a.key.localeCompare(b.key));
}

/** Pre-filled mapping: for each target the best-ranked source field that has values. */
export function suggestMapping(fieldKeys: string[]): Partial<Record<MappingTarget, string>> {
  const byNorm = new Map(fieldKeys.map((key) => [normalizeKey(key), key] as const));
  const mapping: Partial<Record<MappingTarget, string>> = {};
  (Object.keys(SUGGEST) as (keyof typeof SUGGEST)[]).forEach((target) => {
    const hit = SUGGEST[target].find((candidate) => byNorm.has(candidate));
    if (hit) mapping[target] = byNorm.get(hit);
  });
  return mapping;
}

function detectFormat(root: XmlElement): string | null {
  if (root.name === "VanDyke") return "SecureCRT";
  if (root.name === "Connections" && root.attrs.some(([key, value]) => key === "ConfVersion" || /mremoteng/i.test(value))) return "mRemoteNG";
  return null;
}

function ownName(element: XmlElement): string {
  const attr = element.attrs.find(([key]) => NAME_ATTRS.includes(key.toLowerCase()));
  return attr ? attr[1].trim() : "";
}

function fieldsOf(element: XmlElement): Record<string, string> {
  const fields: Record<string, string> = {};
  const put = (key: string, value: string) => {
    if (!key || SECRET_FIELD.test(key) || key in fields) return;
    fields[key] = value.trim();
  };
  element.attrs.forEach(([key, value]) => {
    if (key !== "xmlns") put(key, value);
  });
  element.children.forEach((child) => {
    const childName = child.attrs.find(([key]) => key === "name")?.[1];
    if (child.children.length === 0) {
      put(childName ?? child.name, child.text);
    } else if (childName && child.children.every((item) => item.children.length === 0 && !item.attrs.some(([key]) => key === "name"))) {
      // A list such as SecureCRT's <array name="Description"><string>...</string></array>.
      put(childName, child.children.map((item) => item.text.trim()).filter(Boolean).join("\n"));
    }
  });
  return fields;
}

function decodeText(raw: Buffer): string {
  if (raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le").decode(raw.subarray(2));
  if (raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be").decode(raw.subarray(2));
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return raw.subarray(3).toString("utf8");
  return raw.toString("utf8");
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    if (body in ENTITIES) return ENTITIES[body];
    throw new Error(`The XML file uses an unknown entity (${match}).`);
  });
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** A strict subset of XML 1.0: elements, attributes, text, CDATA, comments, processing instructions. */
function parseXml(text: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new Error("XML files with a DOCTYPE or entity declarations are not supported.");
  }
  const document: XmlElement = { name: "#document", attrs: [], children: [], text: "" };
  const stack: XmlElement[] = [document];
  let count = 0;
  let i = 0;
  const fail = (): never => {
    throw new Error("The XML file is damaged or not well-formed.");
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = text.slice(i, lt === -1 ? text.length : lt);
    if (chunk.trim()) {
      if (stack.length === 1) fail();
      stack[stack.length - 1].text += decodeEntities(chunk);
    }
    if (lt === -1) break;

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) fail();
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1 || stack.length === 1) fail();
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end === -1) fail();
      i = end + 2;
    } else if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt);
      if (end === -1) fail();
      const name = localName(text.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === document || open.name !== name) fail();
      i = end + 1;
    } else {
      const end = findTagEnd(text, lt);
      if (end === -1) fail();
      const selfClosing = text[end - 1] === "/";
      const inner = text.slice(lt + 1, selfClosing ? end - 1 : end);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (!nameMatch) fail();
      const element: XmlElement = { name: localName(nameMatch![0]), attrs: parseAttributes(inner.slice(nameMatch![0].length)), children: [], text: "" };
      count += 1;
      if (count > MAX_ELEMENTS) throw new Error("The XML file has too many elements.");
      if (stack.length === 1 && document.children.length > 0) fail();
      stack[stack.length - 1].children.push(element);
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > MAX_DEPTH) throw new Error("The XML file is nested too deeply.");
      }
      i = end + 1;
    }
  }
  if (stack.length !== 1 || document.children.length !== 1) fail();
  return document.children[0];
}

/** End of a start tag, skipping ">" inside quoted attribute values. */
function findTagEnd(text: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    } else if (char === "<") {
      return -1;
    }
  }
  return -1;
}

function parseAttributes(source: string): [string, string][] {
  const attrs: [string, string][] = [];
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1];
    if (name === "xmlns" || name.startsWith("xmlns:")) continue;
    attrs.push([localName(name), decodeEntities(match[2] ?? match[3] ?? "")]);
  }
  return attrs;
}
