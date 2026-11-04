import { gql, grpcClient } from "../api";
import type { OrderUpdate, Product } from "../types";

export async function fetchProducts(): Promise<Product[]> {
  const data = await gql<{ products: Product[] }>(`
    query GetCatalog {
      products { id name price stock description }
    }
  `);
  return data.products;
}

export interface CheckoutResult {
  orderId: string;
  success: boolean;
  message: string;
}

export async function checkout(
  productId: string,
  quantity: number,
): Promise<CheckoutResult> {
  const data = await gql<{ checkout: CheckoutResult }>(
    `
      mutation CheckoutItem($productId: ID!, $quantity: Int!) {
        checkout(productId: $productId, quantity: $quantity) {
          orderId success message
        }
      }
    `,
    { productId, quantity },
  );
  return data.checkout;
}

// Yields each status change of an order until it is delivered.
export async function* watchOrder(
  orderId: string,
  signal?: AbortSignal,
): AsyncGenerator<OrderUpdate> {
  for await (const update of grpcClient.streamOrderStatus(
    { orderId },
    { signal },
  )) {
    yield {
      status: update.status,
      progressPercentage: update.progressPercentage,
      time: new Date(update.timestamp).toLocaleTimeString(),
    };
  }
}

const STATUS_LABELS: Record<string, string> = {
  ORDER_PLACED: "Order placed",
  PAYMENT_CONFIRMED: "Payment confirmed",
  WAREHOUSE_PACKING: "Being packed",
  DISPATCHED: "On its way",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ??
    status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")
  );
}
