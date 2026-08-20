/** Stable FNV-1a 32-bit hash over UTF-16 code units; it uses no platform APIs. */
export function hashCanonicalJson(canonicalJson: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonicalJson.length; index += 1) {
    hash ^= canonicalJson.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}
