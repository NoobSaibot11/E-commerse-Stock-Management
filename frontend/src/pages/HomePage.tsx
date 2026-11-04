import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import OrderTracker from "../components/OrderTracker";
import ProductCard from "../components/ProductCard";
import { friendlyError, isSessionExpired } from "../errors";
import { useOrderTracking } from "../hooks/useOrderTracking";
import { useProducts } from "../hooks/useProducts";
import { checkout } from "../services/shop";
import type { Product } from "../types";

type Notice = { kind: "success" | "error"; text: string } | null;

export default function HomePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { products, loading, error, refresh } = useProducts();
  const tracking = useOrderTracking();
  const [notice, setNotice] = useState<Notice>(null);

  const handleBuy = async (product: Product, quantity: number) => {
    setNotice(null);
    try {
      const result = await checkout(product.id, quantity);
      if (!result.success) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      setNotice({
        kind: "success",
        text: `Order placed: ${quantity} × ${product.name}.`,
      });
      refresh();
      tracking.track({
        orderId: result.orderId,
        productName: product.name,
        quantity,
      });
    } catch (err) {
      if (isSessionExpired(err)) {
        logout();
        navigate("/login", { replace: true });
        return;
      }
      setNotice({
        kind: "error",
        text: friendlyError(err, "We couldn't place your order. Please try again."),
      });
    }
  };

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Shop</h1>
          <p className="muted">Choose a quantity and buy straight from stock.</p>
        </div>
        <button className="btn btn-ghost" onClick={refresh} disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}

      {loading && products.length === 0 && (
        <p className="muted">Loading products…</p>
      )}
      {error && <p className="alert alert-error">{error}</p>}

      {!error && (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onBuy={handleBuy} />
          ))}
        </div>
      )}

      <OrderTracker
        order={tracking.order}
        updates={tracking.updates}
        live={tracking.live}
        error={tracking.error}
      />
    </>
  );
}
