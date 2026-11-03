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
import {
  createProduct,
  createUser,
  resetDatabase,
  stockOf,
  withToken,
} from "./helpers.js";

// The real handlers, served over an in-memory transport: requests are still
// serialised as protobuf, but no port is opened.
const client = createClient(
  InventoryService,
  createRouterTransport(createRoutes({ stepDelayMs: 0 })),
);

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

let customer: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  customer = await createUser("CUSTOMER");
  admin = await createUser("ADMIN");
});
afterAll(() => prisma.$disconnect());

async function collect<T>(stream: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

// Resolves to the ConnectError a call fails with (or undefined if it succeeds).
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (err) => err as ConnectError,
  );

describe("GetProducts (public)", () => {
  it("returns products with prices as numbers, without a token", async () => {
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

describe("GetStock (public)", () => {
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

describe("UpdateStock (admin only)", () => {
  const update = (productId: string, quantityChange: number, token = admin.token) =>
    client.updateStock({ productId, quantityChange }, withToken(token));

  it("applies the change for an admin", async () => {
    const product = await createProduct({ stock: 10 });
    expect(await update(product.id, -4)).toMatchObject({ success: true, newStock: 6 });
  });

  it("reports insufficient stock with the current level", async () => {
    const product = await createProduct({ stock: 2 });
    expect(await update(product.id, -3)).toMatchObject({
      success: false,
      newStock: 2,
      message: "Insufficient inventory stock",
    });
  });

  it("reports an unknown product", async () => {
    expect(await update(UNKNOWN_ID, 1)).toMatchObject({
      success: false,
      message: "Product not found",
    });
  });

  it("rejects a customer with PermissionDenied and changes nothing", async () => {
    const product = await createProduct({ stock: 10 });

    const err = await errorOf(update(product.id, 100, customer.token));

    expect(err?.code).toBe(Code.PermissionDenied);
    expect(await stockOf(product.id)).toBe(10);
  });

  it("rejects a call without a token with Unauthenticated", async () => {
    const product = await createProduct();
    const err = await errorOf(client.updateStock({ productId: product.id, quantityChange: 1 }));
    expect(err?.code).toBe(Code.Unauthenticated);
  });
});

describe("CreateOrder (signed in)", () => {
  it("places an order for the caller and returns its id and total", async () => {
    const product = await createProduct({ price: "20.00", stock: 5 });

    const res = await client.createOrder(
      { items: [{ productId: product.id, quantity: 3 }] },
      withToken(customer.token),
    );

    expect(res.success).toBe(true);
    expect(res.total).toBe(60);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.userId).toBe(customer.user.id);
    expect(await stockOf(product.id)).toBe(2);
  });

  it("returns business failures as success=false instead of an RPC error", async () => {
    const product = await createProduct({ name: "Headphones", stock: 1 });

    const res = await client.createOrder(
      { items: [{ productId: product.id, quantity: 2 }] },
      withToken(customer.token),
    );

    expect(res).toMatchObject({
      success: false,
      orderId: "",
      message: "Insufficient stock for Headphones",
    });
  });

  it("rejects a call without a token and reserves no stock", async () => {
    const product = await createProduct({ stock: 5 });

    const err = await errorOf(
      client.createOrder({ items: [{ productId: product.id, quantity: 1 }] }),
    );

    expect(err?.code).toBe(Code.Unauthenticated);
    expect(err?.rawMessage).toBe("Sign in to continue");
    expect(await stockOf(product.id)).toBe(5);
  });

  it.each([
    ["a garbage token", "Bearer not-a-jwt"],
    ["a non-bearer scheme", "Basic dXNlcjpwYXNz"],
  ])("rejects %s", async (_, authorization) => {
    const product = await createProduct();
    const err = await errorOf(
      client.createOrder(
        { items: [{ productId: product.id, quantity: 1 }] },
        { headers: { authorization } },
      ),
    );
    expect(err?.code).toBe(Code.Unauthenticated);
  });
});

describe("StreamOrderStatus (owner or admin)", () => {
  async function placeOrder(token = customer.token) {
    const product = await createProduct();
    const res = await client.createOrder(
      { items: [{ productId: product.id, quantity: 1 }] },
      withToken(token),
    );
    return res.orderId;
  }

  const track = (orderId: string, token = customer.token) =>
    collect(client.streamOrderStatus({ orderId }, withToken(token)));

  it("streams every fulfilment step and saves the final status", async () => {
    const orderId = await placeOrder();

    const updates = await track(orderId);

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

    const updates = await track(orderId);

    expect(updates.map((u) => u.status)).toEqual(["DISPATCHED", "DELIVERED"]);
  });

  it("sends a single update for a cancelled order", async () => {
    const orderId = await placeOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });

    const updates = await track(orderId);

    expect(updates.map((u) => [u.status, u.progressPercentage])).toEqual([
      ["CANCELLED", 0],
    ]);
  });

  it("lets an admin track any order", async () => {
    const orderId = await placeOrder(customer.token);
    const updates = await track(orderId, admin.token);
    expect(updates.at(-1)?.status).toBe("DELIVERED");
  });

  it("hides another customer's order as NotFound and leaves it untouched", async () => {
    const orderId = await placeOrder(customer.token);
    const other = await createUser("CUSTOMER");

    const err = await errorOf(track(orderId, other.token));

    expect(err?.code).toBe(Code.NotFound);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("ORDER_PLACED");
  });

  it("fails with NotFound for an unknown order", async () => {
    const err = await errorOf(track(UNKNOWN_ID));
    expect(err?.code).toBe(Code.NotFound);
  });

  it("requires a token", async () => {
    const orderId = await placeOrder();
    const err = await errorOf(collect(client.streamOrderStatus({ orderId })));
    expect(err?.code).toBe(Code.Unauthenticated);
  });
});
