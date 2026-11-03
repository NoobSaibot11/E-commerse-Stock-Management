import "dotenv/config";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "../generated/prisma/client.js";

// Short-lived HS256 access tokens. The secret never leaves this service:
// every other component treats the token as opaque and passes it through.

const ISSUER = "ecommerce-grpc";
const AUDIENCE = "ecommerce-api";

function loadSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters. Copy .env.example to .env.",
    );
  }
  return new TextEncoder().encode(secret);
}

const secret = loadSecret();
const expiresIn = process.env.JWT_EXPIRES_IN ?? "1h";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/** Returns the user a token was issued to, or null if it's invalid or expired. */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Pin the algorithm so a token can't pick a weaker one (e.g. "none").
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      (payload.role !== "CUSTOMER" && payload.role !== "ADMIN")
    ) {
      return null;
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
