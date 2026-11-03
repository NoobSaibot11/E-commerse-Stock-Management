import { beforeEach, describe, expect, it, vi } from "vitest";
import { graphql } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  createResolvers,
  typeDefs,
  type Context,
  type GrpcClients,
} from "../src/schema.js";

// The BFF has no data of its own, so these tests run the real GraphQL schema
// against fake gRPC clients and check what it asks for and returns.
const fake = {
  inventory: {
    getProducts: vi.fn(),
    getStock: vi.fn(),
    createOrder: vi.fn(),
  },
  auth: {
    register: vi.fn(),
    login: vi.fn(),
    getMe: vi.fn(),
  },
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers: createResolvers(fake as unknown as GrpcClients),
});

const run = (
  source: string,
  variableValues?: Record<string, unknown>,
  contextValue: Context = { authorization: null },
) => graphql({ schema, source, variableValues, contextValue });

const signedIn: Context = { authorization: "Bearer test-token" };
const forwarded = { headers: { authorization: "Bearer test-token" } };

const keyboard = {
  id: "p1",
  name: "Keyboard",
  price: 129.99,
  stock: 15,
  description: "Mechanical",
};
const mouse = { id: "p2", name: "Mouse", price: 79.99, stock: 42, description: "Wireless" };
const user = { id: "u1", email: "shopper@example.com", role: "CUSTOMER" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Query.products", () => {
  it("returns the catalog from GetProducts", async () => {
    fake.inventory.getProducts.mockResolvedValue({ products: [keyboard, mouse] });

    const result = await run("{ products { id name price stock description } }");

    expect(result.errors).toBeUndefined();
    expect(result.data?.products).toEqual([keyboard, mouse]);
  });

  it("surfaces a gRPC failure as a GraphQL error", async () => {
    fake.inventory.getProducts.mockRejectedValue(new Error("connection refused"));

    const result = await run("{ products { id } }");

    expect(result.errors?.[0].message).toBe("connection refused");
  });
});

describe("Query.product", () => {
  it("returns the product with stock from GetStock", async () => {
    fake.inventory.getProducts.mockResolvedValue({ products: [keyboard, mouse] });
    fake.inventory.getStock.mockResolvedValue({ productId: "p1", stock: 3, price: 129.99 });

    const result = await run('{ product(id: "p1") { id name stock } }');

    expect(fake.inventory.getStock).toHaveBeenCalledWith({ productId: "p1" });
    expect(result.data?.product).toEqual({ id: "p1", name: "Keyboard", stock: 3 });
  });

  it("returns null for an unknown product", async () => {
    fake.inventory.getProducts.mockResolvedValue({ products: [keyboard] });
    fake.inventory.getStock.mockResolvedValue({ productId: "nope", stock: 0, price: 0 });

    const result = await run('{ product(id: "nope") { id } }');

    expect(result.errors).toBeUndefined();
    expect(result.data?.product).toBeNull();
  });
});

describe("Query.me", () => {
  it("returns null without calling gRPC when no token is sent", async () => {
    const result = await run("{ me { id } }");

    expect(result.errors).toBeUndefined();
    expect(result.data?.me).toBeNull();
    expect(fake.auth.getMe).not.toHaveBeenCalled();
  });

  it("forwards the token to GetMe and returns the user", async () => {
    fake.auth.getMe.mockResolvedValue({ user });

    const result = await run("{ me { id email role } }", undefined, signedIn);

    expect(fake.auth.getMe).toHaveBeenCalledWith({}, forwarded);
    expect(result.data?.me).toEqual(user);
  });

  it("reports an expired token as UNAUTHENTICATED", async () => {
    fake.auth.getMe.mockRejectedValue(
      new ConnectError("Your session is invalid or has expired. Sign in again.", Code.Unauthenticated),
    );

    const result = await run("{ me { id } }", undefined, signedIn);

    expect(result.errors?.[0].message).toBe(
      "Your session is invalid or has expired. Sign in again.",
    );
    expect(result.errors?.[0].extensions.code).toBe("UNAUTHENTICATED");
  });
});

describe("Mutation.register / login", () => {
  const LOGIN = /* GraphQL */ `
    mutation ($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
        user { id email role }
      }
    }
  `;

  it("returns the token and user from Login", async () => {
    fake.auth.login.mockResolvedValue({ token: "jwt", user });

    const result = await run(LOGIN, { email: "shopper@example.com", password: "pw-12345" });

    expect(fake.auth.login).toHaveBeenCalledWith({
      email: "shopper@example.com",
      password: "pw-12345",
    });
    expect(result.data?.login).toEqual({ token: "jwt", user });
  });

  it("passes on a bad-credentials message as UNAUTHENTICATED", async () => {
    fake.auth.login.mockRejectedValue(
      new ConnectError("Invalid email or password", Code.Unauthenticated),
    );

    const result = await run(LOGIN, { email: "x@y.co", password: "nope-nope" });

    expect(result.errors?.[0].message).toBe("Invalid email or password");
    expect(result.errors?.[0].extensions.code).toBe("UNAUTHENTICATED");
  });

  it("maps a duplicate registration to BAD_USER_INPUT", async () => {
    fake.auth.register.mockRejectedValue(
      new ConnectError("An account with this email already exists", Code.AlreadyExists),
    );

    const result = await run(
      `mutation { register(email: "a@b.co", password: "pw-12345") { token } }`,
    );

    expect(result.errors?.[0].message).toBe("An account with this email already exists");
    expect(result.errors?.[0].extensions.code).toBe("BAD_USER_INPUT");
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

  it("creates a single-item order and forwards the caller's token", async () => {
    fake.inventory.createOrder.mockResolvedValue({
      orderId: "order-123",
      success: true,
      message: "Order placed successfully",
      total: 259.98,
    });

    const result = await run(CHECKOUT, { productId: "p1", quantity: 2 }, signedIn);

    expect(fake.inventory.createOrder).toHaveBeenCalledWith(
      { items: [{ productId: "p1", quantity: 2 }] },
      forwarded,
    );
    expect(result.data?.checkout).toMatchObject({ orderId: "order-123", success: true });
  });

  it("passes on the reason when the order is rejected", async () => {
    fake.inventory.createOrder.mockResolvedValue({
      orderId: "",
      success: false,
      message: "Insufficient stock for Keyboard",
      total: 0,
    });

    const result = await run(CHECKOUT, { productId: "p1", quantity: 99 }, signedIn);

    expect(result.data?.checkout).toEqual({
      orderId: "",
      success: false,
      message: "Insufficient stock for Keyboard",
    });
  });

  it("reports a signed-out checkout as UNAUTHENTICATED", async () => {
    fake.inventory.createOrder.mockRejectedValue(
      new ConnectError("Sign in to continue", Code.Unauthenticated),
    );

    const result = await run(CHECKOUT, { productId: "p1", quantity: 1 });

    expect(fake.inventory.createOrder).toHaveBeenCalledWith(
      { items: [{ productId: "p1", quantity: 1 }] },
      {},
    );
    expect(result.errors?.[0].message).toBe("Sign in to continue");
    expect(result.errors?.[0].extensions.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a missing quantity before calling gRPC", async () => {
    const result = await run(CHECKOUT, { productId: "p1" }, signedIn);

    expect(result.errors?.[0].message).toMatch(/quantity/);
    expect(fake.inventory.createOrder).not.toHaveBeenCalled();
  });
});
