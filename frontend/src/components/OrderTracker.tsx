import type { TrackedOrder } from "../hooks/useOrderTracking";
import { statusLabel } from "../services/shop";
import type { OrderUpdate } from "../types";

interface OrderTrackerProps {
  order: TrackedOrder | null;
  updates: OrderUpdate[];
  live: boolean;
  error: string | null;
}

export default function OrderTracker({
  order,
  updates,
  live,
  error,
}: OrderTrackerProps) {
  const latest = updates[updates.length - 1];

  return (
    <section className="card tracker">
      <h2>Your order</h2>

      {!order ? (
        <p className="muted">
          Nothing ordered yet. Pick a product above and press Buy to follow
          your order here.
        </p>
      ) : (
        <>
          <p>
            <strong>
              {order.quantity} × {order.productName}
            </strong>
            <span className="muted small"> · Order #{order.orderId.slice(0, 8)}</span>
          </p>

          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={latest?.progressPercentage ?? 0}
          >
            <div
              className="progress-fill"
              style={{ width: `${latest?.progressPercentage ?? 0}%` }}
            />
          </div>
          <p className="muted small progress-label">
            {latest ? statusLabel(latest.status) : "Getting your order ready…"}
            {live && latest && latest.progressPercentage < 100 && " · updating live"}
          </p>

          {updates.length > 0 && (
            <ol className="timeline">
              {updates.map((u, i) => (
                <li key={i}>
                  <span className="time">{u.time}</span>
                  {statusLabel(u.status)}
                </li>
              ))}
            </ol>
          )}

          {error && <p className="alert alert-error">{error}</p>}
        </>
      )}
    </section>
  );
}
