import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password hashing with Node's built-in scrypt: a memory-hard KDF that OWASP
// recommends, with no native module to compile. Each hash is stored as
// "scrypt$N$r$p$salt$hash" so the cost can be raised later without breaking
// existing hashes.

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
// scrypt needs ~128 * N * r bytes; allow headroom above Node's 32 MiB default.
const MAX_MEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    ...COST,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !hashB64) return false;

  try {
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scryptAsync(
      password,
      Buffer.from(saltB64, "base64"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM },
    );
    // Constant-time comparison so response timing doesn't leak how much matched.
    return timingSafeEqual(actual, expected);
  } catch {
    // Corrupt cost parameters make scrypt throw; treat as a mismatch.
    return false;
  }
}
