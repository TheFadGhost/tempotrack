export interface Envelope {
  app: "tempotrack";
  format: number;
  checksum: string;
  data: string;
}

/** FNV-1a 32-bit, hex. Dependency-free integrity check for stored payloads. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function seal(dbJson: string): Envelope {
  return { app: "tempotrack", format: 1, checksum: fnv1a(dbJson), data: dbJson };
}

export function open(envelopeJson: string | null | undefined): string | null {
  if (!envelopeJson) return null;
  let env: unknown;
  try {
    env = JSON.parse(envelopeJson);
  } catch {
    return null;
  }
  const e = env as Partial<Envelope>;
  if (e.app !== "tempotrack" || typeof e.data !== "string" || typeof e.checksum !== "string") return null;
  if (fnv1a(e.data) !== e.checksum) return null;
  return e.data;
}
