import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { InventoryService } from "../src/gen/proto/ecommerce/v1/inventory_pb.js";
import { prisma } from "../src/db.js";
import { createRoutes } from "../src/routes.js";
import { createProduct, resetDatabase, stockOf } from "./helpers.js";

// The real handlers, served over an in-memory transport: requests are still
// serialised as protobuf, but no port is opened.
const client = createClient(
  InventoryService,
  createRouterTransport(createRoutes({ stepDelayMs: 0 })),
);

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function collect<T>(stream: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe("GetProducts", () => {
  it("returns products with prices as numbers", async () => {
    const product = await createProduct({ name: "Monitor", price: "499.99", stock: 8 });

    const { products } = await client.getProducts({});

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: product.id,
      name: "Monitor",
      price: 499.99,
      stock: 8,
    });
  });
});

describe("GetStock", () => {
  it("returns stock and price for a product", async () => {
    const product = await createProduct({ price: "12.50", stock: 3 });
    const res = await client.getStock({ productId: product.id });
    expect(res).toMatchObject({ productId: product.id, stock: 3, price: 12.5 });
  });

  it("returns zeros for an unknown product", async () => {
    const res = await client.getStock({ productId: UNKNOWN_ID });
    expect(res).toMatchObject({ stock: 0, price: 0 });
  });
});

describe("UpdateStock", () => {
  it("applies the change", async () => {
    const product = await createProduct({ stock: 10 });
    const res = await client.updateStock({ productId: product.id, quantityChange: -4 });
    expect(res).toMatchObject({ success: true, newStock: 6 });
  });

  it("reports insufficient stock with the current level", async () => {
    const product = await createProduct({ stock: 2 });
    const res = await client.updateStock({ productId: product.id, quantityChange: -3 });
    expect(res).toMatchObject({
      success: false,
      newStock: 2,
      message: "Insufficient inventory stock",
    });
  });

  it("reports an unknown product", async () => {
    const res = await client.updateStock({ productId: UNKNOWN_ID, quantityChange: 1 });
    expect(res).toMatchObject({ success: false, message: "Product not found" });
  });
});

describe("CreateOrder", () => {
  it("places an order and returns its id and total", async () => {
    const product = await createProduct({ price: "20.00", stock: 5 });

    const res = await client.createOrder({
      items: [{ productId: product.id, quantity: 3 }],
    });

    expect(res.success).toBe(true);
    expect(res.total).toBe(60);
    expect(await prisma.order.findUnique({ where: { id: res.orderId } })).not.toBeNull();
    expect(await stockOf(product.id)).toBe(2);
  });

  it("returns business failures as success=false instead of an RPC error", async () => {
    const product = await createProduct({ name: "Headphones", stock: 1 });

    const res = await client.createOrder({
      items: [{ productId: product.id, quantity: 2 }],
    });

    expect(res).toMatchObject({
      success: false,
      orderId: "",
      message: "Insufficient stock for Headphones",
    });
  });
});

describe("StreamOrderStatus", () => {
  async function placeOrder() {
    const product = await createProduct();
    const res = await client.createOrder({
      items: [{ productId: product.id, quantity: 1 }],
    });
    return res.orderId;
  }

  it("streams every fulfilment step and saves the final status", async () => {
    const orderId = await placeOrder();

    const updates = await collect(client.streamOrderStatus({ orderId }));

    expect(updates.map((u) => [u.status, u.progressPercentage])).toEqual([
      ["ORDER_PLACED", 10],
      ["PAYMENT_CONFIRMED", 35],
      ["WAREHOUSE_PACKING", 65],
      ["DISPATCHED", 85],
      ["DELIVERED", 100],
    ]);
    expect(updates.every((u) => u.orderId === orderId)).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");
  });

  it("resumes from the saved status when reconnecting", async () => {
    const orderId = await placeOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: "DISPATCHED" } });

    const updates = await collect(client.streamOrderStatus({ orderId }));

    expect(updates.map((u) => u.status)).toEqual(["DISPATCHED", "DELIVERED"]);
  });

  it("sends a single update for a cancelled order", async () => {
    const orderId = await placeOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });

    const updates = await collect(client.streamOrderStatus({ orderId }));

    expect(updates.map((u) => [u.status, u.progressPercentage])).toEqual([
      ["CANCELLED", 0],
    ]);
  });

  it("fails with NotFound for an unknown order", async () => {
    const error = await collect(
      client.streamOrderStatus({ orderId: UNKNOWN_ID }),
    ).catch((err) => err);

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
  });
});
