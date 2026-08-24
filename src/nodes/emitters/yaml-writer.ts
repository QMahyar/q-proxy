export type YamlScalar = string | number | boolean | null;

export interface YamlObject {
  [key: string]: YamlValue;
}

export type YamlValue = YamlScalar | YamlObject | YamlValue[];

const SAFE_PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_\-./]*$/;
const NUMBER_LIKE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const BOOL_LIKE = /^(?:true|false|yes|no|on|off|null|~)$/i;

function fmtScalar(v: YamlScalar): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "null";
  if (v.length === 0 || !SAFE_PLAIN.test(v) || NUMBER_LIKE.test(v) || BOOL_LIKE.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function isScalarArray(v: YamlValue[]): v is YamlScalar[] {
  return v.every((item) => typeof item !== "object" || item === null);
}

function writeEntry(
  lines: string[],
  key: string,
  value: YamlValue,
  indent: number,
  prefix: string,
): void {
  const pad = " ".repeat(indent) + prefix;
  const childIndent = indent + prefix.length + 2;
  if (typeof value !== "object" || value === null) {
    lines.push(`${pad}${key}: ${fmtScalar(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (isScalarArray(value)) {
      lines.push(`${pad}${key}: [${value.map(fmtScalar).join(", ")}]`);
      return;
    }
    lines.push(`${pad}${key}:`);
    for (const item of value) {
      emitObject(lines, item as YamlObject, childIndent, "- ");
    }
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    lines.push(`${pad}${key}: {}`);
    return;
  }
  lines.push(`${pad}${key}:`);
  emitObject(lines, value, childIndent, "");
}

function emitObject(
  lines: string[],
  obj: YamlObject,
  indent: number,
  firstPrefix: string,
): void {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const prefix = i === 0 ? firstPrefix : " ".repeat(firstPrefix.length);
    writeEntry(lines, k, obj[k]!, indent, prefix);
  }
}

export function writeYaml(doc: YamlObject): string {
  const lines: string[] = [];
  emitObject(lines, doc, 0, "");
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
