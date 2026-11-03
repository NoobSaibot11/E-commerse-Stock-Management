import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import {
  InventoryError,
  adjustStock,
  createOrder,
  getProduct,
  listProducts,
  setOrderStatus,
} from "../src/inventory.js";
import { createProduct, createUser, resetDatabase, stockOf } from "./helpers.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

// Every order belongs to a user.
let customerId: string;

beforeEach(async () => {
  await resetDatabase();
  customerId = (await createUser()).user.id;
});
afterAll(() => prisma.$disconnect());

describe("listProducts", () => {
  it("returns all products sorted by name", async () => {
    await createProduct({ name: "Zebra Stand" });
    await createProduct({ name: "Apple Dock" });

    const names = (await listProducts()).map((p) => p.name);

    expect(names).toEqual(["Apple Dock", "Zebra Stand"]);
  });
});

describe("getProduct", () => {
  it("finds a product by id", async () => {
    const product = await createProduct({ name: "Keyboard" });
    expect((await getProduct(product.id))?.name).toBe("Keyboard");
  });

  it("returns null for an unknown id", async () => {
    expect(await getProduct(UNKNOWN_ID)).toBeNull();
  });

  it("returns null for a malformed id instead of throwing", async () => {
    expect(await getProduct("prod-1")).toBeNull();
  });
});

describe("adjustStock", () => {
  it("adds stock", async () => {
    const product = await createProduct({ stock: 10 });
    expect(await adjustStock(product.id, 5)).toBe(15);
    expect(await stockOf(product.id)).toBe(15);
  });

  it("removes stock", async () => {
    const product = await createProduct({ stock: 10 });
    expect(await adjustStock(product.id, -3)).toBe(7);
  });

  it("allows taking stock to exactly zero", async () => {
    const product = await createProduct({ stock: 4 });
    expect(await adjustStock(product.id, -4)).toBe(0);
  });

  it("rejects a change that would go below zero and leaves stock alone", async () => {
    const product = await createProduct({ stock: 4 });
    expect(await adjustStock(product.id, -5)).toBeNull();
    expect(await stockOf(product.id)).toBe(4);
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await adjustStock(UNKNOWN_ID, 1)).toBeNull();
    expect(await adjustStock("prod-1", 1)).toBeNull();
  });

  it("never oversells under concurrent requests", async () => {
    const product = await createProduct({ stock: 10 });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => adjustStock(product.id, -1)),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(10);
    expect(await stockOf(product.id)).toBe(0);
  });
});

describe("createOrder", () => {
  it("creates an order, snapshots prices and reserves stock", async () => {
    const keyboard = await createProduct({ price: "129.99", stock: 5 });
    const mouse = await createProduct({ price: "79.99", stock: 5 });

    const { orderId, total } = await createOrder(customerId, [
      { productId: keyboard.id, quantity: 2 },
      { productId: mouse.id, quantity: 1 },
    ]);

    expect(total.toFixed(2)).toBe("339.97");
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    expect(order.status).toBe("ORDER_PLACED");
    expect(order.userId).toBe(customerId);
    expect(order.total.toFixed(2)).toBe("339.97");
    expect(order.items).toHaveLength(2);
    expect(
      order.items.find((i) => i.productId === keyboard.id)?.unitPrice.toFixed(2),
    ).toBe("129.99");
    expect(await stockOf(keyboard.id)).toBe(3);
    expect(await stockOf(mouse.id)).toBe(4);
  });

  it("keeps the purchase price when the product price changes later", async () => {
    const product = await createProduct({ price: "50.00" });
    const { orderId } = await createOrder(customerId, [{ productId: product.id, quantity: 1 }]);

    await prisma.product.update({
      where: { id: product.id },
      data: { price: "75.00" },
    });

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(item.unitPrice.toFixed(2)).toBe("50.00");
  });

  it("merges duplicate lines for the same product", async () => {
    const product = await createProduct({ stock: 10 });

    const { orderId } = await createOrder(customerId, [
      { productId: product.id, quantity: 2 },
      { productId: product.id, quantity: 3 },
    ]);

    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
    expect(await stockOf(product.id)).toBe(5);
  });

  it("rolls back every line if any line is out of stock", async () => {
    const plenty = await createProduct({ stock: 10 });
    const scarce = await createProduct({ name: "Rare Item", stock: 1 });

    await expect(
      createOrder(customerId, [
        { productId: plenty.id, quantity: 3 },
        { productId: scarce.id, quantity: 2 },
      ]),
    ).rejects.toThrow(new InventoryError("Insufficient stock for Rare Item"));

    expect(await stockOf(plenty.id)).toBe(10);
    expect(await stockOf(scarce.id)).toBe(1);
    expect(await prisma.order.count()).toBe(0);
  });

  it("rejects an unknown product", async () => {
    await expect(
      createOrder(customerId, [{ productId: UNKNOWN_ID, quantity: 1 }]),
    ).rejects.toThrow(`Product ${UNKNOWN_ID} not found`);
    await expect(
      createOrder(customerId, [{ productId: "prod-1", quantity: 1 }]),
    ).rejects.toThrow(InventoryError);
  });

  it("rejects an empty order", async () => {
    await expect(createOrder(customerId, [])).rejects.toThrow(
      "An order must contain at least one item",
    );
  });

  it.each([0, -1, 1.5])("rejects quantity %s", async (quantity) => {
    const product = await createProduct();
    await expect(
      createOrder(customerId, [{ productId: product.id, quantity }]),
    ).rejects.toThrow("Quantity must be a positive whole number");
    expect(await stockOf(product.id)).toBe(10);
  });

  it("never oversells when many customers check out at once", async () => {
    const product = await createProduct({ stock: 5 });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        createOrder(customerId, [{ productId: product.id, quantity: 1 }]),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    expect(rejected.every((r) => r.reason instanceof InventoryError)).toBe(true);
    expect(await stockOf(product.id)).toBe(0);
    expect(await prisma.order.count()).toBe(5);
  });
});

describe("setOrderStatus", () => {
  it("updates the saved status", async () => {
    const product = await createProduct();
    const { orderId } = await createOrder(customerId, [{ productId: product.id, quantity: 1 }]);

    await setOrderStatus(orderId, "DISPATCHED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DISPATCHED");
  });
});

describe("database constraints", () => {
  it("rejects negative stock even when application code is bypassed", async () => {
    const product = await createProduct();
    await expect(
      prisma.$executeRaw`UPDATE products SET stock = -1 WHERE id = ${product.id}::uuid`,
    ).rejects.toThrow(/products_stock_non_negative/);
  });

  it("rejects a duplicate SKU", async () => {
    await prisma.product.create({ data: { sku: "DUP", name: "A", price: "1.00" } });
    await expect(
      prisma.product.create({ data: { sku: "DUP", name: "B", price: "1.00" } }),
    ).rejects.toThrow();
  });
});
