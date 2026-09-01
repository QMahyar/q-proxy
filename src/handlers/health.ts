import { appVersion } from "../settings/store";

export const handleHealth = async (req: Request): Promise<Response> => {
  const cf = req.cf as { colo?: string } | undefined;
  const colo = cf?.colo ?? null;
  const body = JSON.stringify({ ok: true, version: appVersion(), colo });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
