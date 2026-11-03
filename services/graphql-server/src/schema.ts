import {
  Code,
  ConnectError,
  createClient,
  type CallOptions,
  type Client,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { GraphQLError } from "graphql";
import { InventoryService } from "../../grpc-server/src/gen/proto/ecommerce/v1/inventory_pb.js";
import { AuthService } from "../../grpc-server/src/gen/proto/ecommerce/v1/auth_pb.js";

export interface GrpcClients {
  inventory: Client<typeof InventoryService>;
  auth: Client<typeof AuthService>;
}

// Per-request context. The BFF doesn't check tokens itself: it forwards the
// caller's Authorization header and the gRPC service decides.
export interface Context {
  authorization: string | null;
}

// Node 18+ native fetch / web transport
const transport = createConnectTransport({
  baseUrl: process.env.GRPC_URL ?? "http://127.0.0.1:50051",
});

export const grpcClients: GrpcClients = {
  inventory: createClient(InventoryService, transport),
  auth: createClient(AuthService, transport),
};

export const typeDefs = /* GraphQL */ `
  type Product {
    id: ID!
    name: String!
    price: Float!
    stock: Int!
    description: String!
  }

  type User {
    id: ID!
    email: String!
    role: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type CheckoutResponse {
    orderId: String!
    success: Boolean!
    message: String!
  }

  type Query {
    products: [Product!]!
    product(id: ID!): Product
    "The signed-in user, or null when no token is sent."
    me: User
  }

  type Mutation {
    register(email: String!, password: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    checkout(productId: ID!, quantity: Int!): CheckoutResponse!
  }
`;

// gRPC status -> GraphQL error code. These errors are meant for the client,
// so their messages are passed through; anything else is left for Yoga to
// mask as "Unexpected error".
const ERROR_CODES: Partial<Record<Code, string>> = {
  [Code.Unauthenticated]: "UNAUTHENTICATED",
  [Code.PermissionDenied]: "FORBIDDEN",
  [Code.InvalidArgument]: "BAD_USER_INPUT",
  [Code.AlreadyExists]: "BAD_USER_INPUT",
  [Code.NotFound]: "NOT_FOUND",
};

async function callGrpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConnectError && ERROR_CODES[err.code]) {
      throw new GraphQLError(err.rawMessage, {
        extensions: { code: ERROR_CODES[err.code] },
      });
    }
    throw err;
  }
}

const forwardAuth = (ctx: Context): CallOptions =>
  ctx.authorization ? { headers: { authorization: ctx.authorization } } : {};

// Resolvers take the gRPC clients as a parameter so tests can pass fakes.
export const createResolvers = ({ inventory, auth }: GrpcClients) => ({
  Query: {
    products: async () => {
      console.log(
        "[GraphQL BFF] Received 'products' GraphQL query. Calling gRPC GetProducts...",
      );
      try {
        const response = await inventory.getProducts({});
        return response.products;
      } catch (err) {
        console.error("[GraphQL BFF] Error calling gRPC GetProducts:", err);
        throw err;
      }
    },
    product: async (_: unknown, args: { id: string }) => {
      console.log(
        `[GraphQL BFF] Received 'product(id: "${args.id}")' query. Calling gRPC GetStock...`,
      );
      const stockResp = await inventory.getStock({ productId: args.id });
      const productsResp = await inventory.getProducts({});
      const item = productsResp.products.find((p) => p.id === args.id);
      if (!item) return null;
      return {
        ...item,
        stock: stockResp.stock,
      };
    },
    me: async (_: unknown, __: unknown, ctx: Context) => {
      // Not signed in is a normal state for this query, not an error.
      if (!ctx.authorization) return null;
      const { user } = await callGrpc(() => auth.getMe({}, forwardAuth(ctx)));
      return user;
    },
  },
  Mutation: {
    register: async (_: unknown, args: { email: string; password: string }) => {
      console.log("[GraphQL BFF] Register mutation");
      return callGrpc(() => auth.register(args));
    },
    login: async (_: unknown, args: { email: string; password: string }) => {
      console.log("[GraphQL BFF] Login mutation");
      return callGrpc(() => auth.login(args));
    },
    checkout: async (
      _: unknown,
      args: { productId: string; quantity: number },
      ctx: Context,
    ) => {
      console.log(
        `[GraphQL BFF] Checkout mutation for product: ${args.productId}, quantity: ${args.quantity}`,
      );

      const orderResp = await callGrpc(() =>
        inventory.createOrder(
          { items: [{ productId: args.productId, quantity: args.quantity }] },
          forwardAuth(ctx),
        ),
      );

      if (!orderResp.success) {
        return {
          orderId: "",
          success: false,
          message: orderResp.message,
        };
      }

      return {
        orderId: orderResp.orderId,
        success: true,
        message:
          "Order placed successfully! You can track live status via direct gRPC stream.",
      };
    },
  },
});

export const resolvers = createResolvers(grpcClients);
