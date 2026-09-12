import { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import http from "node:http";
import { InventoryService } from "./gen/proto/ecommerce/v1/inventory_connect.js";
import {
  GetProductsRequest,
  GetProductsResponse,
  GetProductsResponseSchema,
  GetStockRequest,
  GetStockResponse,
  GetStockResponseSchema,
  UpdateStockRequest,
  UpdateStockResponse,
  UpdateStockResponseSchema,
  StreamOrderStatusRequest,
  StreamOrderStatusResponse,
  StreamOrderStatusResponseSchema,
} from "./gen/proto/ecommerce/v1/inventory_pb.js";

// In-Memory Database for demonstration
const mockProducts = [
  {
    id: "prod-1",
    name: "Wireless Mechanical Keyboard",
    price: 129.99,
    stock: 15,
    description: "Hot-swappable RGB keyboard with tactile switches.",
  },
  {
    id: "prod-2",
    name: "Ergonomic Gaming Mouse",
    price: 79.99,
    stock: 42,
    description: "Ultra-lightweight wireless mouse with 26K DPI sensor.",
  },
  {
    id: "prod-3",
    name: "4K UltraWide Monitor",
    price: 499.99,
    stock: 8,
    description: "34-inch curved monitor with 144Hz refresh rate.",
  },
  {
    id: "prod-4",
    name: "Noise-Canceling Headphones",
    price: 249.99,
    stock: 20,
    description: "Over-ear bluetooth headphones with high-res audio.",
  },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function routes(router: ConnectRouter) {
  router.service(InventoryService, {
    async getProducts(req: GetProductsRequest): Promise<GetProductsResponse> {
      console.log("[gRPC Microservice] Received GetProducts RPC call");
      return create(GetProductsResponseSchema, {
        products: mockProducts.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          stock: p.stock,
          description: p.description,
        })),
      });
    },

    async getStock(req: GetStockRequest): Promise<GetStockResponse> {
      console.log(
        `[gRPC Microservice] Received GetStock RPC for product: ${req.productId}`,
      );
      const item = mockProducts.find((p) => p.id === req.productId);
      if (!item) {
        return create(GetStockResponseSchema, {
          productId: req.productId,
          stock: 0,
          price: 0,
        });
      }
      return create(GetStockResponseSchema, {
        productId: item.id,
        stock: item.stock,
        price: item.price,
      });
    },

    async updateStock(req: UpdateStockRequest): Promise<UpdateStockResponse> {
      console.log(
        `[gRPC Microservice] Received UpdateStock RPC for ${req.productId} (change: ${req.quantityChange})`,
      );
      const item = mockProducts.find((p) => p.id === req.productId);
      if (!item) {
        return create(UpdateStockResponseSchema, {
          productId: req.productId,
          newStock: 0,
          success: false,
          message: "Product not found",
        });
      }

      const newStock = item.stock + req.quantityChange;
      if (newStock < 0) {
        return create(UpdateStockResponseSchema, {
          productId: req.productId,
          newStock: item.stock,
          success: false,
          message: "Insufficient inventory stock",
        });
      }

      item.stock = newStock;
      return create(UpdateStockResponseSchema, {
        productId: req.productId,
        newStock: item.stock,
        success: true,
        message: "Stock successfully updated",
      });
    },

    async *streamOrderStatus(
      req: StreamOrderStatusRequest,
    ): AsyncIterable<StreamOrderStatusResponse> {
      console.log(
        `[gRPC Microservice] Started streaming order status for order: ${req.orderId}`,
      );

      const statuses = [
        { status: "ORDER_PLACED", progress: 10 },
        { status: "PAYMENT_CONFIRMED", progress: 35 },
        { status: "WAREHOUSE_PACKING", progress: 65 },
        { status: "DISPATCHED", progress: 85 },
        { status: "DELIVERED", progress: 100 },
      ];

      for (const step of statuses) {
        await sleep(1500);
        yield create(StreamOrderStatusResponseSchema, {
          orderId: req.orderId,
          status: step.status,
          progressPercentage: step.progress,
          timestamp: new Date().toISOString(),
        });
      }
    },
  });
}

const PORT = 50051;

// Create Connect Node HTTP Handler with CORS headers
const handler = connectNodeAdapter({
  routes,
});

const server = http.createServer((req, res) => {
  // CORS setup for Frontend / GraphQL origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Connect-Content-Encoding, Connect-Accept-Encoding",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  handler(req, res);
});

server.listen(PORT, () => {
  console.log(
    `🚀 gRPC / Connect Microservice is running on http://localhost:${PORT}`,
  );
});
