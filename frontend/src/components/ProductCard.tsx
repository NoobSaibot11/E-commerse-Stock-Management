import { useState, type FormEvent } from "react";
import type { Product } from "../types";

interface ProductCardProps {
  product: Product;
  onBuy: (product: Product, quantity: number) => Promise<void>;
}

export default function ProductCard({ product, onBuy }: ProductCardProps) {
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const inStock = product.stock > 0;
  const maxQty = Math.max(product.stock, 1);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBuying(true);
    try {
      await onBuy(product, quantity);
      setQuantity(1);
    } finally {
      setBuying(false);
    }
  };

  return (
    <article className="card product-card">
      <div>
        <h3>{product.name}</h3>
        <p className="muted small">{product.description}</p>
        <p className="price">${product.price.toFixed(2)}</p>
        <p className={inStock ? "stock in" : "stock out"}>
          {inStock ? `${product.stock} in stock` : "Out of stock"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="buy-form">
        <label className="qty">
          <span>Qty</span>
          <input
            type="number"
            min={1}
            max={maxQty}
            required
            disabled={!inStock || buying}
            value={quantity}
            onChange={(e) =>
              setQuantity(
                Math.min(maxQty, Math.max(1, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!inStock || buying}
        >
          {!inStock
            ? "Sold out"
            : buying
              ? "Placing order…"
              : `Buy · $${(product.price * quantity).toFixed(2)}`}
        </button>
      </form>
    </article>
  );
}
