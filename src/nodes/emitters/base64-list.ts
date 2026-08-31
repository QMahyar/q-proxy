import type { EmitOptions } from "./registry";
import { tlsRequiredNodes } from "./registry";
import type { ProxyNode } from "../../types/node";
import { encodeUtf8Base64 } from "../../utils/base64";
import { buildShareUris } from "../share-uri";

export function emitBase64List(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = tlsRequiredNodes(nodes, opts.isFragment).filter((n) => n.kind !== "ss");
  return encodeUtf8Base64(buildShareUris(visible).join("\n"));
}
