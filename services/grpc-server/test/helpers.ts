import { prisma } from "../src/db.js";

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

export async function stockOf(id: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id } });
  return product.stock;
}
