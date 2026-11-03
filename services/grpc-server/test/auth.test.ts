import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { SignJWT } from "jose";
import { AuthService } from "../src/gen/proto/ecommerce/v1/auth_pb.js";
import { prisma } from "../src/db.js";
import { createRoutes } from "../src/routes.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { signToken, verifyToken } from "../src/auth/tokens.js";
import { createUser, resetDatabase, withToken } from "./helpers.js";

const client = createClient(
  AuthService,
  createRouterTransport(createRoutes({ stepDelayMs: 0 })),
);

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (err) => err as ConnectError,
  );

// Signs a token the way an attacker or a misconfigured service might.
const forge = (
  claims: Record<string, unknown>,
  {
    secret = process.env.JWT_SECRET!,
    issuer = "ecommerce-grpc",
    audience = "ecommerce-api",
    expiresAt = "1h" as string | number,
    subject = "00000000-0000-0000-0000-000000000000",
  } = {},
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("never stores the password and salts every hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toContain("same-password");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
  });

  it.each(["", "unused", "bcrypt$x$y", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="])(
    "treats a malformed stored hash %j as a mismatch",
    async (stored) => {
      expect(await verifyPassword("anything", stored)).toBe(false);
    },
  );
});

describe("tokens", () => {
  const user = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "a@b.co",
    role: "CUSTOMER" as const,
  };

  it("round-trips the user through a signed token", async () => {
    expect(await verifyToken(await signToken(user))).toEqual(user);
  });

  it("rejects an expired token", async () => {
    const token = await forge(
      { email: user.email, role: user.role },
      { expiresAt: Math.floor(Date.now() / 1000) - 60 },
    );
    expect(await verifyToken(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await forge(
      { email: user.email, role: "ADMIN" },
      { secret: "attacker-secret-0123456789abcdef0123456789" },
    );
    expect(await verifyToken(token)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const [header, , signature] = (await signToken(user)).split(".");
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, email: user.email, role: "ADMIN" }),
    ).toString("base64url");
    expect(await verifyToken(`${header}.${payload}.${signature}`)).toBeNull();
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${encode({ alg: "none" })}.${encode({
      sub: user.id,
      email: user.email,
      role: "ADMIN",
      iss: "ecommerce-grpc",
      aud: "ecommerce-api",
    })}.`;
    expect(await verifyToken(token)).toBeNull();
  });

  it("rejects the wrong issuer or audience", async () => {
    const claims = { email: user.email, role: user.role };
    expect(await verifyToken(await forge(claims, { issuer: "someone-else" }))).toBeNull();
    expect(await verifyToken(await forge(claims, { audience: "other-api" }))).toBeNull();
  });

  it("rejects a token with an unknown role", async () => {
    expect(await verifyToken(await forge({ email: user.email, role: "ROOT" }))).toBeNull();
  });
});

describe("Register", () => {
  it("creates a customer, stores a hash and returns a working token", async () => {
    const res = await client.register({ email: "New@Example.com ", password: "s3cret-pass" });

    expect(res.user).toMatchObject({ email: "new@example.com", role: "CUSTOMER" });
    expect(await verifyToken(res.token)).toMatchObject({ id: res.user!.id });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.user!.id } });
    expect(stored.passwordHash).not.toContain("s3cret-pass");
  });

  it("rejects a duplicate email regardless of case with AlreadyExists", async () => {
    await client.register({ email: "dup@example.com", password: "password-1" });

    const err = await errorOf(
      client.register({ email: "DUP@example.com", password: "password-2" }),
    );

    expect(err?.code).toBe(Code.AlreadyExists);
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ["an invalid email", "not-an-email", "password-123", "Enter a valid email address"],
    ["a short password", "ok@example.com", "short", "Password must be at least 8 characters"],
  ])("rejects %s with InvalidArgument", async (_, email, password, message) => {
    const err = await errorOf(client.register({ email, password }));
    expect(err?.code).toBe(Code.InvalidArgument);
    expect(err?.rawMessage).toBe(message);
  });

  it("can't be used to create an admin", async () => {
    const res = await client.register({ email: "sneaky@example.com", password: "password-123" });
    expect(res.user?.role).toBe("CUSTOMER");
  });
});

describe("Login", () => {
  beforeEach(async () => {
    await client.register({ email: "shopper@example.com", password: "right-password" });
  });

  it("returns a token for the right password, ignoring email case", async () => {
    const res = await client.login({ email: "SHOPPER@example.com", password: "right-password" });
    expect(res.user?.email).toBe("shopper@example.com");
    expect(await verifyToken(res.token)).not.toBeNull();
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrongPassword = await errorOf(
      client.login({ email: "shopper@example.com", password: "wrong-password" }),
    );
    const unknownEmail = await errorOf(
      client.login({ email: "nobody@example.com", password: "right-password" }),
    );

    for (const err of [wrongPassword, unknownEmail]) {
      expect(err?.code).toBe(Code.Unauthenticated);
      expect(err?.rawMessage).toBe("Invalid email or password");
    }
  });
});

describe("GetMe", () => {
  it("returns the user the token belongs to", async () => {
    const { user, token } = await createUser("ADMIN");
    const res = await client.getMe({}, withToken(token));
    expect(res.user).toMatchObject({ id: user.id, email: user.email, role: "ADMIN" });
  });

  it("requires a token", async () => {
    const err = await errorOf(client.getMe({}));
    expect(err?.code).toBe(Code.Unauthenticated);
  });

  it("rejects a valid token for an account that was deleted", async () => {
    const { user, token } = await createUser();
    await prisma.user.delete({ where: { id: user.id } });

    const err = await errorOf(client.getMe({}, withToken(token)));

    expect(err?.code).toBe(Code.Unauthenticated);
  });
});
