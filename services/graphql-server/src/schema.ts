import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { InventoryService } from "../../grpc-server/src/gen/proto/ecommerce/v1/inventory_connect.js";

// Node 18+ native fetch / web transport
const transport = createConnectTransport({
  baseUrl: "http://127.0.0.1:50051",
});

export const grpcClient = createClient(InventoryService, transport);

export const typeDefs = /* GraphQL */ `
  type Product {
    id: ID!
    name: String!
    price: Float!
    stock: Int!
    description: String!
  }

  type CheckoutResponse {
    orderId: String!
    success: Boolean!
    message: String!
  }

  type Query {
    products: [Product!]!
    product(id: ID!): Product
  }

  type Mutation {
    checkout(productId: ID!, quantity: Int!): CheckoutResponse!
  }
`;

export const resolvers = {
  Query: {
    products: async () => {
      console.log(
        "[GraphQL BFF] Received 'products' GraphQL query. Calling gRPC GetProducts...",
      );
      try {
        const response = await grpcClient.getProducts({});
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
      const stockResp = await grpcClient.getStock({ productId: args.id });
      const productsResp = await grpcClient.getProducts({});
      const item = productsResp.products.find((p) => p.id === args.id);
      if (!item) return null;
      return {
        ...item,
        stock: stockResp.stock,
      };
    },
  },
  Mutation: {
    checkout: async (
      _: unknown,
      args: { productId: string; quantity: number },
    ) => {
      console.log(
        `[GraphQL BFF] Checkout mutation for product: ${args.productId}, quantity: ${args.quantity}`,
      );

      const updateResp = await grpcClient.updateStock({
        productId: args.productId,
        quantityChange: -args.quantity,
      });

      if (!updateResp.success) {
        return {
          orderId: "",
          success: false,
          message: updateResp.message,
        };
      }

      const orderId = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;

      return {
        orderId,
        success: true,
        message:
          "Order placed successfully! You can track live status via direct gRPC stream.",
      };
    },
  },
};
