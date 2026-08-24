declare module "node:crypto" {
  export interface NodeHash {
    update(data: Uint8Array): NodeHash;
    digest(options: { outputLength: number }): Uint8Array;
  }
  export interface NodeCipher {
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
    setAAD(aad: Uint8Array): void;
    setAuthTag(tag: Uint8Array): void;
    getAuthTag(): Uint8Array;
  }
  export function createHash(algorithm: string): NodeHash;
  export function createCipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array,
    options?: { authTagLength?: number },
  ): NodeCipher;
  export function createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array,
    options?: { authTagLength?: number },
  ): NodeCipher;
  export function randomBytes(length: number): Uint8Array;
  export function hash(
    algorithm: string,
    data: Uint8Array,
    options?: { outputLength?: number; encoding?: string },
  ): Uint8Array | string;
}
