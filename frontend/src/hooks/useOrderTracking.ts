import { useCallback, useEffect, useRef, useState } from "react";
import { watchOrder } from "../services/shop";
import type { OrderUpdate } from "../types";

export interface TrackedOrder {
  orderId: string;
  productName: string;
  quantity: number;
}

export function useOrderTracking() {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [updates, setUpdates] = useState<OrderUpdate[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const track = useCallback(async (next: TrackedOrder) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    setOrder(next);
    setUpdates([]);
    setError(null);
    setLive(true);
    try {
      for await (const update of watchOrder(next.orderId, abort.signal)) {
        setUpdates((prev) => [...prev, update]);
      }
    } catch {
      if (!abort.signal.aborted) {
        setError("Live updates stopped. Refresh the page to check again.");
      }
    } finally {
      if (controller.current === abort) setLive(false);
    }
  }, []);

  // Stop listening when leaving the page.
  useEffect(() => () => controller.current?.abort(), []);

  return { order, updates, live, error, track };
}
