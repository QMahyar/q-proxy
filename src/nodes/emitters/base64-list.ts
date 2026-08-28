import type { EmitOptions } from "./registry";
import { visibleNodes } from "./registry";
import type { ProxyNode } from "../../types/node";
import { encodeUtf8Base64 } from "../../utils/base64";
import { buildShareUris } from "../share-uri";

export function emitBase64List(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  return encodeUtf8Base64(buildShareUris(visible).join("\n"));
}
