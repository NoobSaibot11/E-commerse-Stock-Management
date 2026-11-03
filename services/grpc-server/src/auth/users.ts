import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthUser } from "./tokens.js";

// An expected auth failure (bad input, duplicate email), as opposed to a bug.
export class AuthError extends Error {
  constructor(
    message: string,
    readonly reason: "invalid_input" | "email_taken" | "invalid_credentials",
  ) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toAuthUser = (user: AuthUser): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
});

export async function registerUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) {
    throw new AuthError("Enter a valid email address", "invalid_input");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      "invalid_input",
    );
  }

  try {
    const user = await prisma.user.create({
      data: { email: normalized, passwordHash: await hashPassword(password) },
    });
    return toAuthUser(user);
  } catch (err) {
    // Unique violation on email. Checking first instead would race with a
    // concurrent registration for the same address.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AuthError("An account with this email already exists", "email_taken");
    }
    throw err;
  }
}

// Hashed once at startup and checked against when the email is unknown, so
// "no such user" takes as long as "wrong password" and timing can't reveal
// which emails have accounts.
const dummyHash = hashPassword("not-a-real-password");

export async function authenticate(
  email: string,
  password: string,
): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  const valid = await verifyPassword(
    password,
    user?.passwordHash ?? (await dummyHash),
  );
  if (!user || !valid) {
    // Same message either way, so it can't be used to discover accounts.
    throw new AuthError("Invalid email or password", "invalid_credentials");
  }
  return toAuthUser(user);
}

export async function findUser(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user && toAuthUser(user);
}
