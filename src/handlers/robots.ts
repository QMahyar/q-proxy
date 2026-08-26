export function handleRobots(): Response {
  return new Response("User-agent: *\nDisallow: /", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
