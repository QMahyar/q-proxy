import { describe, expect, it } from "vitest";
import type { YamlObject } from "../../../src/nodes/emitters/yaml-writer";
import { writeYaml } from "../../../src/nodes/emitters/yaml-writer";

describe("writeYaml", () => {
  it("quotes scalars that would parse as other types", () => {
    expect(writeYaml({ a: "123", b: "true", c: "null", d: "x", e: "" })).toBe(
      'a: "123"\nb: "true"\nc: "null"\nd: x\ne: ""\n',
    );
  });

  it("escapes quotes and backslashes inside double-quoted scalars", () => {
    expect(writeYaml({ k: 'say "hi" \\ ok' })).toBe('k: "say \\"hi\\" \\\\ ok"\n');
  });

  it("serializes nested maps with stable indentation", () => {
    expect(writeYaml({ top: { mid: { deep: 1 } } })).toBe("top:\n  mid:\n    deep: 1\n");
  });

  it("serializes inline scalar arrays and empty collections", () => {
    expect(writeYaml({ list: [1, "a", true], none: [], obj: {} })).toBe(
      'list: [1, a, true]\nnone: []\nobj: {}\n',
    );
  });

  it("serializes arrays of objects with dash alignment", () => {
    const doc: YamlObject = {
      items: [{ a: 1, b: "x y", nested: { c: "/p" } }, { a: 2 }],
    };
    expect(writeYaml(doc)).toBe(
      'items:\n  - a: 1\n    b: "x y"\n    nested:\n      c: "/p"\n  - a: 2\n',
    );
  });

  it("returns an empty string for an empty document", () => {
    expect(writeYaml({})).toBe("");
  });
});
