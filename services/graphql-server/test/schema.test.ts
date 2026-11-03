import { beforeEach, describe, expect, it, vi } from "vitest";
import { graphql } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { createResolvers, typeDefs, type InventoryClient } from "../src/schema.js";

// The BFF has no data of its own, so these tests run the real GraphQL schema
// against a fake gRPC client and check what it asks for and returns.
const fakeClient = {
  getProducts: vi.fn(),
  getStock: vi.fn(),
  createOrder: vi.fn(),
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers: createResolvers(fakeClient as unknown as InventoryClient),
});

const run = (source: string, variableValues?: Record<string, unknown>) =>
  graphql({ schema, source, variableValues });

const keyboard = {
  id: "p1",
  name: "Keyboard",
  price: 129.99,
  stock: 15,
  description: "Mechanical",
};
const mouse = { id: "p2", name: "Mouse", price: 79.99, stock: 42, description: "Wireless" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Query.products", () => {
  it("returns the catalog from GetProducts", async () => {
    fakeClient.getProducts.mockResolvedValue({ products: [keyboard, mouse] });

    const result = await run("{ products { id name price stock description } }");

    expect(result.errors).toBeUndefined();
    expect(result.data?.products).toEqual([keyboard, mouse]);
  });

  it("surfaces a gRPC failure as a GraphQL error", async () => {
    fakeClient.getProducts.mockRejectedValue(new Error("connection refused"));

    const result = await run("{ products { id } }");

    expect(result.errors?.[0].message).toBe("connection refused");
  });
});

describe("Query.product", () => {
  it("returns the product with stock from GetStock", async () => {
    fakeClient.getProducts.mockResolvedValue({ products: [keyboard, mouse] });
    fakeClient.getStock.mockResolvedValue({ productId: "p1", stock: 3, price: 129.99 });

    const result = await run('{ product(id: "p1") { id name stock } }');

    expect(fakeClient.getStock).toHaveBeenCalledWith({ productId: "p1" });
    expect(result.data?.product).toEqual({ id: "p1", name: "Keyboard", stock: 3 });
  });

  it("returns null for an unknown product", async () => {
    fakeClient.getProducts.mockResolvedValue({ products: [keyboard] });
    fakeClient.getStock.mockResolvedValue({ productId: "nope", stock: 0, price: 0 });

    const result = await run('{ product(id: "nope") { id } }');

    expect(result.errors).toBeUndefined();
    expect(result.data?.product).toBeNull();
  });
});

describe("Mutation.checkout", () => {
  const CHECKOUT = /* GraphQL */ `
    mutation ($productId: ID!, $quantity: Int!) {
      checkout(productId: $productId, quantity: $quantity) {
        orderId
        success
        message
      }
    }
  `;

  it("creates a single-item order through CreateOrder", async () => {
    fakeClient.createOrder.mockResolvedValue({
      orderId: "order-123",
      success: true,
      message: "Order placed successfully",
      total: 259.98,
    });

    const result = await run(CHECKOUT, { productId: "p1", quantity: 2 });

    expect(fakeClient.createOrder).toHaveBeenCalledWith({
      items: [{ productId: "p1", quantity: 2 }],
    });
    expect(result.data?.checkout).toMatchObject({ orderId: "order-123", success: true });
  });

  it("passes on the reason when the order is rejected", async () => {
    fakeClient.createOrder.mockResolvedValue({
      orderId: "",
      success: false,
      message: "Insufficient stock for Keyboard",
      total: 0,
    });

    const result = await run(CHECKOUT, { productId: "p1", quantity: 99 });

    expect(result.data?.checkout).toEqual({
      orderId: "",
      success: false,
      message: "Insufficient stock for Keyboard",
    });
  });

  it("rejects a missing quantity before calling gRPC", async () => {
    const result = await run(CHECKOUT, { productId: "p1" });

    expect(result.errors?.[0].message).toMatch(/quantity/);
    expect(fakeClient.createOrder).not.toHaveBeenCalled();
  });
});
