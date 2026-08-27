export function pruneBoundedRegistry(
  registry: Map<string, number>,
  limit: number,
  nowEpochSeconds: number,
): void {
  for (const [key, expiry] of registry) {
    if (expiry > nowEpochSeconds) continue;
    registry.delete(key);
  }
  while (registry.size > limit) {
    const oldest = registry.keys().next();
    if (oldest.done) break;
    registry.delete(oldest.value);
  }
}
