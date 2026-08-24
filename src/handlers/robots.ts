import type { RouteHandler } from "../types/context";

export const handleRobots: RouteHandler = async () => {
  return new Response("User-agent: *\nDisallow: /", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
