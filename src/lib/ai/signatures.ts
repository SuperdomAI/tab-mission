/**
 * Stable fingerprints for AI cache invalidation.
 *
 * AI results are content-addressed: a result is only reusable while the
 * inputs that produced it are unchanged. These signatures collapse a tab set
 * or an analytics window into a short, stable hash so cached results
 * invalidate on real change and survive trivial churn (order shuffles,
 * ephemeral fields like `lastActiveAt`).
 *
 * SHA-1 is used deliberately over a hand-rolled primitives: it is a cache
 * key, not a security boundary, and the synchronous implementation below
 * keeps the cache API synchronous (no async plumbing in the service worker).
 */

const encoder = new TextEncoder();

/**
 * Synchronous SHA-1 (RFC 3174) over the UTF-8 bytes of `input`, hex-encoded.
 * Used for content addressing only — not a cryptographic boundary.
 */
export function sha1Hex(input: string): string {
  const msg = encoder.encode(input);
  const bitLen = msg.length * 8;
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;

  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, hi);
  dv.setUint32(padded.length - 4, lo);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = dv.getUint32(i + j * 4);
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function hex(w: number): string {
  return w.toString(16).padStart(8, "0");
}

// ─── Input fingerprints ────────────────────────────────────────────────────

/**
 * The tab fields that matter for AI decisions. Deliberately excludes
 * `lastActiveAt` and similar churny fields so triage/suggestion results stay
 * cached across trivial activations.
 */
export interface TabSigInput {
  id: number;
  title: string;
  url?: string;
  domain?: string;
  openedAt?: number;
  visitCount?: number;
}

/** Order-independent fingerprint of a tab set. */
export function tabSetSignature(tabs: TabSigInput[]): string {
  const sorted = [...tabs].sort((a, b) => a.id - b.id);
  const canon = sorted
    .map((t) =>
      [
        t.id,
        t.title,
        t.url ?? "",
        t.domain ?? "",
        t.openedAt ?? 0,
        t.visitCount ?? 0,
      ].join("|"),
    )
    .join("\n");
  return sha1Hex(canon);
}

export interface DaySigInput {
  date: string;
  opened: number;
  closed: number;
  peak: number;
  debt: number;
  domainTime?: Record<string, number>;
}

/** Order-independent fingerprint of an analytics window (e.g. last 30 days). */
export function analyticsSignature(days: DaySigInput[]): string {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const canon = sorted
    .map((d) =>
      [
        d.date,
        d.opened,
        d.closed,
        d.peak,
        d.debt,
        JSON.stringify(d.domainTime ?? {}),
      ].join("|"),
    )
    .join("\n");
  return sha1Hex(canon);
}

/** Fingerprint of the installed model set (re-resolve hints when it changes). */
export function modelSetSignature(models: string[]): string {
  return sha1Hex([...models].sort().join("\n"));
}

/** Fingerprint of page content for summarize-then-close (F6). */
export function pageSignature(title: string, text: string): string {
  return sha1Hex(`${title}\n${text}`);
}