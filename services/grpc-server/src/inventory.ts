import { prisma } from "./db.js";
import { Prisma, OrderStatus } from "./generated/prisma/client.js";

// Data access for the inventory service. Kept separate from the gRPC
// handlers so it can be unit tested against a real database.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres rejects malformed UUIDs with an error, so treat them as "not found"
// before they reach the database.
export const isUuid = (id: string) => UUID_RE.test(id);

// An expected business failure (bad input, out of stock), as opposed to a bug.
export class InventoryError extends Error {}

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { name: "asc" } });
}

export async function getProduct(id: string) {
  if (!isUuid(id)) return null;
  return prisma.product.findUnique({ where: { id } });
}

/**
 * Adds `change` (negative to remove) to a product's stock in one statement.
 * The check and the update happen together inside Postgres, so two concurrent
 * requests can never both pass the check and oversell.
 *
 * Returns the new stock, or null if the product doesn't exist or the change
 * would take stock below zero.
 */
export async function adjustStock(
  id: string,
  change: number,
): Promise<number | null> {
  if (!isUuid(id)) return null;
  const rows = await prisma.$queryRaw<{ stock: number }[]>`
    UPDATE products
    SET stock = stock + ${change}, updated_at = now()
    WHERE id = ${id}::uuid AND stock + ${change} >= 0
    RETURNING stock
  `;
  return rows[0]?.stock ?? null;
}

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

/**
 * Creates an order for a user and reserves stock for every line in one
 * transaction. If any line can't be fulfilled, the whole transaction rolls
 * back and no stock changes.
 */
export async function createOrder(userId: string, lines: OrderLineInput[]) {
  if (lines.length === 0) {
    throw new InventoryError("An order must contain at least one item");
  }

  // Merge duplicate lines for the same product.
  const quantities = new Map<string, number>();
  for (const { productId, quantity } of lines) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InventoryError("Quantity must be a positive whole number");
    }
    if (!isUuid(productId)) {
      throw new InventoryError(`Product ${productId} not found`);
    }
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }

  // Lock rows in a consistent order so two concurrent multi-item orders
  // can't deadlock waiting on each other.
  const productIds = [...quantities.keys()].sort();

  return prisma.$transaction(async (tx) => {
    const items: { productId: string; quantity: number; unitPrice: Prisma.Decimal }[] = [];

    for (const productId of productIds) {
      const quantity = quantities.get(productId)!;
      const { count } = await tx.product.updateMany({
        where: { id: productId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });

      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { name: true, price: true },
      });
      if (!product) {
        throw new InventoryError(`Product ${productId} not found`);
      }
      if (count === 0) {
        throw new InventoryError(`Insufficient stock for ${product.name}`);
      }
      items.push({ productId, quantity, unitPrice: product.price });
    }

    const total = items.reduce(
      (sum, item) => sum.plus(item.unitPrice.times(item.quantity)),
      new Prisma.Decimal(0),
    );

    const order = await tx.order.create({
      data: { userId, total, items: { create: items } },
    });
    return { orderId: order.id, total };
  });
}

export async function getOrder(id: string) {
  if (!isUuid(id)) return null;
  return prisma.order.findUnique({ where: { id } });
}

export async function setOrderStatus(id: string, status: OrderStatus) {
  return prisma.order.update({ where: { id }, data: { status } });
}
