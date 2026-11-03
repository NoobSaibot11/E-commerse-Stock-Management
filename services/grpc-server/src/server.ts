import { Code, ConnectError, ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import http from "node:http";
import {
  InventoryService,
  GetProductsRequest,
  GetProductsResponse,
  GetProductsResponseSchema,
  GetStockRequest,
  GetStockResponse,
  GetStockResponseSchema,
  UpdateStockRequest,
  UpdateStockResponse,
  UpdateStockResponseSchema,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateOrderResponseSchema,
  StreamOrderStatusRequest,
  StreamOrderStatusResponse,
  StreamOrderStatusResponseSchema,
} from "./gen/proto/ecommerce/v1/inventory_pb.js";
import { prisma } from "./db.js";
import {
  InventoryError,
  adjustStock,
  createOrder,
  getOrder,
  getProduct,
  listProducts,
  setOrderStatus,
} from "./inventory.js";
import { OrderStatus } from "./generated/prisma/client.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Simulated fulfilment pipeline. Each step is persisted to the order row,
// so reconnecting to the stream resumes from the order's real status.
const FULFILMENT_STEPS: { status: OrderStatus; progress: number }[] = [
  { status: OrderStatus.ORDER_PLACED, progress: 10 },
  { status: OrderStatus.PAYMENT_CONFIRMED, progress: 35 },
  { status: OrderStatus.WAREHOUSE_PACKING, progress: 65 },
  { status: OrderStatus.DISPATCHED, progress: 85 },
  { status: OrderStatus.DELIVERED, progress: 100 },
];

function routes(router: ConnectRouter) {
  router.service(InventoryService, {
    async getProducts(req: GetProductsRequest): Promise<GetProductsResponse> {
      console.log("[gRPC Microservice] Received GetProducts RPC call");
      const products = await listProducts();
      return create(GetProductsResponseSchema, {
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price.toNumber(),
          stock: p.stock,
          description: p.description,
        })),
      });
    },

    async getStock(req: GetStockRequest): Promise<GetStockResponse> {
      console.log(
        `[gRPC Microservice] Received GetStock RPC for product: ${req.productId}`,
      );
      const item = await getProduct(req.productId);
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
        price: item.price.toNumber(),
      });
    },

    async updateStock(req: UpdateStockRequest): Promise<UpdateStockResponse> {
      console.log(
        `[gRPC Microservice] Received UpdateStock RPC for ${req.productId} (change: ${req.quantityChange})`,
      );
      const newStock = await adjustStock(req.productId, req.quantityChange);
      if (newStock !== null) {
        return create(UpdateStockResponseSchema, {
          productId: req.productId,
          newStock,
          success: true,
          message: "Stock successfully updated",
        });
      }

      // The update was rejected; find out why for a useful message.
      const item = await getProduct(req.productId);
      return create(UpdateStockResponseSchema, {
        productId: req.productId,
        newStock: item?.stock ?? 0,
        success: false,
        message: item ? "Insufficient inventory stock" : "Product not found",
      });
    },

    async createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
      console.log(
        `[gRPC Microservice] Received CreateOrder RPC with ${req.items.length} item(s)`,
      );
      try {
        const { orderId, total } = await createOrder(req.items);
        return create(CreateOrderResponseSchema, {
          orderId,
          success: true,
          message: "Order placed successfully",
          total: total.toNumber(),
        });
      } catch (err) {
        if (err instanceof InventoryError) {
          return create(CreateOrderResponseSchema, {
            success: false,
            message: err.message,
          });
        }
        throw err;
      }
    },

    async *streamOrderStatus(
      req: StreamOrderStatusRequest,
    ): AsyncIterable<StreamOrderStatusResponse> {
      console.log(
        `[gRPC Microservice] Started streaming order status for order: ${req.orderId}`,
      );

      const order = await getOrder(req.orderId);
      if (!order) {
        throw new ConnectError(`Order ${req.orderId} not found`, Code.NotFound);
      }

      const toResponse = (status: OrderStatus, progress: number) =>
        create(StreamOrderStatusResponseSchema, {
          orderId: order.id,
          status,
          progressPercentage: progress,
          timestamp: new Date().toISOString(),
        });

      const current = FULFILMENT_STEPS.findIndex(
        (s) => s.status === order.status,
      );
      if (current === -1) {
        // CANCELLED or another terminal status outside the pipeline.
        yield toResponse(order.status, 0);
        return;
      }

      yield toResponse(order.status, FULFILMENT_STEPS[current].progress);
      for (const step of FULFILMENT_STEPS.slice(current + 1)) {
        await sleep(1500);
        await setOrderStatus(order.id, step.status);
        yield toResponse(step.status, step.progress);
      }
    },
  });
}

const PORT = Number(process.env.PORT ?? 50051);

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

// Close the HTTP server and database pool cleanly (Ctrl+C, docker stop).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
