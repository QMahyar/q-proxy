import camoHtml from "./camo.html";
import loginHtml from "./login.html";
import panelHtml from "./panel.html";

export const ASSETS = {
  panel: panelHtml,
  login: loginHtml,
  camo: camoHtml,
} as const;

export const TOKEN_HINT_SUFFIX = "…";

export type AssetName = keyof typeof ASSETS;
