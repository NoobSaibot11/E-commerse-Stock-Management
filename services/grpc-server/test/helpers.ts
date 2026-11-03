import { prisma } from "../src/db.js";
import { signToken } from "../src/auth/tokens.js";
import type { UserRole } from "../src/generated/prisma/client.js";

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "order_items", "orders", "users", "products" CASCADE',
  );
}

let skuCounter = 0;

export function createProduct(
  overrides: Partial<{
    name: string;
    price: string;
    stock: number;
    description: string;
  }> = {},
) {
  skuCounter++;
  return prisma.product.create({
    data: {
      sku: `TEST-${skuCounter}`,
      name: `Test Product ${skuCounter}`,
      price: "10.00",
      stock: 10,
      ...overrides,
    },
  });
}

let userCounter = 0;

// A user plus a valid token for them. The password hash is a placeholder:
// tests that log in with a password go through registerUser instead.
export async function createUser(role: UserRole = "CUSTOMER") {
  userCounter++;
  const user = await prisma.user.create({
    data: {
      email: `user${userCounter}@test.local`,
      passwordHash: "unused",
      role,
    },
  });
  const token = await signToken(user);
  return { user, token };
}

// Call options that send a bearer token, for Connect client calls.
export const withToken = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

export async function stockOf(id: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id } });
  return product.stock;
}
