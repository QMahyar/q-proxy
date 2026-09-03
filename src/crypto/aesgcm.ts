export type AesGcmKey = CryptoKey;

const encCache = new Map<string, AesGcmKey>();
const decCache = new Map<string, AesGcmKey>();
const CACHE_LIMIT = 256;

let importCount = 0;

function hexOf(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

function cachedImport(cache: Map<string, AesGcmKey>, key: Uint8Array): AesGcmKey | null {
  return cache.get(hexOf(key)) ?? null;
}

function storeImport(cache: Map<string, AesGcmKey>, key: Uint8Array, ck: AesGcmKey): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(hexOf(key), ck);
}

export async function aesGcmKeyFor(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<AesGcmKey> {
  const cache = usage === "encrypt" ? encCache : decCache;
  const hit = cachedImport(cache, key);
  if (hit !== null) return hit;
  importCount += 1;
  const ck = (await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [usage])) as AesGcmKey;
  storeImport(cache, key, ck);
  return ck;
}

export async function aesGcmSealWith(
  ck: AesGcmKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array | null,
): Promise<Uint8Array> {
  const params: { name: "AES-GCM"; iv: Uint8Array; tagLength: number; additionalData?: Uint8Array } =
    { name: "AES-GCM", iv: nonce, tagLength: 128 };
  if (aad) params.additionalData = aad;
  return new Uint8Array(await crypto.subtle.encrypt(params, ck, plaintext as BufferSource));
}

export async function aesGcmOpenWith(
  ck: AesGcmKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array | null,
): Promise<Uint8Array | null> {
  try {
    const params: { name: "AES-GCM"; iv: Uint8Array; tagLength: number; additionalData?: Uint8Array } =
      { name: "AES-GCM", iv: nonce, tagLength: 128 };
    if (aad) params.additionalData = aad;
    return new Uint8Array(await crypto.subtle.decrypt(params, ck, ciphertext as BufferSource));
  } catch {
    return null;
  }
}

export function aesGcmKeyImportsForTests(): number {
  return importCount;
}

export function resetAesGcmKeyCacheForTests(): void {
  encCache.clear();
  decCache.clear();
  importCount = 0;
}
