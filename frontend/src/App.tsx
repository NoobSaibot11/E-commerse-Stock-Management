import { useEffect, useState } from "react";
import AuthPanel from "./AuthPanel";
import {
  GraphQLRequestError,
  gql,
  grpcClient,
  tokenStore,
  type User,
} from "./api";

const USER_FIELDS = "id email role";

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  description: string;
}

interface OrderStreamUpdate {
  status: string;
  progressPercentage: number;
  timestamp: string;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Order state & live stream status
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [orderStreamLogs, setOrderStreamLogs] = useState<OrderStreamUpdate[]>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);

  const [user, setUser] = useState<User | null>(null);

  // 0. Authentication: register/login return a JWT, which api.ts attaches
  // to every later GraphQL and gRPC call.
  const handleAuth = async (
    mode: "login" | "register",
    email: string,
    password: string,
  ) => {
    const data = await gql<Record<string, { token: string; user: User }>>(
      `
        mutation Auth($email: String!, $password: String!) {
          ${mode}(email: $email, password: $password) {
            token
            user { ${USER_FIELDS} }
          }
        }
      `,
      { email, password },
    );
    tokenStore.set(data[mode].token);
    setUser(data[mode].user);
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
    setActiveOrderId(null);
    setOrderStreamLogs([]);
  };

  // A stored token may have expired since the last visit; ask the server.
  const restoreSession = async () => {
    if (!tokenStore.get()) return;
    try {
      const data = await gql<{ me: User | null }>(`query Me { me { ${USER_FIELDS} } }`);
      if (data.me) setUser(data.me);
      else tokenStore.clear();
    } catch {
      tokenStore.clear();
    }
  };

  // 1. Fetch Product Catalog using GraphQL Query (standard HTTP POST to /graphql endpoint)
  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    setError(null);
    try {
      const data = await gql<{ products: Product[] }>(`
        query GetCatalog {
          products {
            id
            name
            price
            stock
            description
          }
        }
      `);
      setProducts(data.products);
    } catch (err: any) {
      setError(
        err instanceof GraphQLRequestError
          ? err.message
          : `Failed to reach GraphQL server: ${err.message}`,
      );
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    restoreSession();
    fetchCatalog();
  }, []);

  // 2. Perform Checkout using GraphQL Mutation
  const handleCheckout = async (productId: string) => {
    try {
      const data = await gql<{
        checkout: { orderId: string; success: boolean; message: string };
      }>(
        `
          mutation CheckoutItem($productId: ID!, $quantity: Int!) {
            checkout(productId: $productId, quantity: $quantity) {
              orderId
              success
              message
            }
          }
        `,
        { productId, quantity: 1 },
      );
      const res = data.checkout;

      if (res.success) {
        alert(`Order Placed! Order ID: ${res.orderId}`);
        setActiveOrderId(res.orderId);
        fetchCatalog();
        startGrpcOrderStream(res.orderId);
      } else {
        alert(`Checkout failed: ${res.message}`);
      }
    } catch (err: any) {
      if (err instanceof GraphQLRequestError && err.code === "UNAUTHENTICATED") {
        logout();
        alert(`${err.message}`);
        return;
      }
      alert(`Checkout error: ${err.message}`);
    }
  };

  // 3. Track Live Order Status via Direct gRPC-Web / Connect Server Stream!
  const startGrpcOrderStream = async (orderId: string) => {
    setIsStreaming(true);
    setOrderStreamLogs([]);
    console.log(
      `[Frontend] Subscribing to gRPC Stream for order: ${orderId}...`,
    );

    try {
      const stream = grpcClient.streamOrderStatus({ orderId });
      for await (const update of stream) {
        console.log("[Frontend] Received gRPC stream update:", update);
        setOrderStreamLogs((prev) => [
          ...prev,
          {
            status: update.status,
            progressPercentage: update.progressPercentage,
            timestamp: new Date(update.timestamp).toLocaleTimeString(),
          },
        ]);
      }
    } catch (err: any) {
      console.error("[Frontend] gRPC Stream error:", err);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: "900px",
        margin: "40px auto",
        padding: "0 20px",
      }}
    >
      <header
        style={{
          borderBottom: "2px solid #eaeaea",
          paddingBottom: "16px",
          marginBottom: "32px",
        }}
      >
        <h1 style={{ margin: 0, color: "#1a1a1a" }}>
          🛒 Full-Stack E-Commerce Learning App
        </h1>
        <p style={{ color: "#666", marginTop: "8px" }}>
          Combining <strong>GraphQL (BFF Layer)</strong> &amp;{" "}
          <strong>
            gRPC / Connect-RPC (Microservice &amp; Browser Streaming)
          </strong>
        </p>
      </header>

      <AuthPanel user={user} onSubmit={handleAuth} onLogout={logout} />

      {/* SECTION 1: GRAPHQL CATALOG */}
      <section style={{ marginBottom: "40px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2>1. Product Catalog (Loaded via GraphQL Query)</h2>
          <button
            onClick={fetchCatalog}
            style={{ cursor: "pointer", padding: "6px 12px" }}
          >
            🔄 Refresh Catalog
          </button>
        </div>

        {loadingCatalog && <p>Loading catalog from GraphQL BFF...</p>}
        {error && <p style={{ color: "red" }}>Error: {error}</p>}

        {!loadingCatalog && !error && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "20px",
            }}
          >
            {products.map((p) => (
              <div
                key={p.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  backgroundColor: "#fff",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 8px 0" }}>{p.name}</h3>
                  <p
                    style={{
                      color: "#555",
                      fontSize: "14px",
                      margin: "0 0 12px 0",
                    }}
                  >
                    {p.description}
                  </p>
                  <p
                    style={{
                      fontWeight: "bold",
                      fontSize: "18px",
                      margin: "0 0 8px 0",
                    }}
                  >
                    ${p.price.toFixed(2)}
                  </p>
                  <p
                    style={{
                      color: p.stock > 0 ? "green" : "red",
                      fontSize: "14px",
                    }}
                  >
                    Stock available: {p.stock} units
                  </p>
                </div>

                <button
                  disabled={p.stock <= 0 || !user}
                  onClick={() => handleCheckout(p.id)}
                  style={{
                    marginTop: "16px",
                    padding: "10px",
                    backgroundColor: p.stock > 0 && user ? "#0066cc" : "#ccc",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: p.stock > 0 && user ? "pointer" : "not-allowed",
                    fontWeight: "bold",
                  }}
                >
                  {p.stock <= 0
                    ? "Out of Stock"
                    : user
                      ? "Buy Now (GraphQL Mutation)"
                      : "Sign in to buy"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2: DIRECT gRPC REAL-TIME STREAMING */}
      <section
        style={{
          border: "1px solid #0066cc",
          borderRadius: "8px",
          padding: "20px",
          backgroundColor: "#f4f8ff",
        }}
      >
        <h2>2. Live Order Tracking (Direct gRPC-Web Server Stream)</h2>
        <p style={{ color: "#555" }}>
          This component bypasses GraphQL and communicates directly with the
          gRPC microservice over an HTTP stream!
        </p>

        {activeOrderId ? (
          <div>
            <p>
              <strong>Tracking Order ID:</strong> <code>{activeOrderId}</code>
            </p>
            {isStreaming && (
              <p style={{ color: "#0066cc" }}>
                ⚡ Connection Active: Receiving live gRPC stream updates...
              </p>
            )}

            {/* Progress bar */}
            {orderStreamLogs.length > 0 && (
              <div style={{ margin: "20px 0" }}>
                <div
                  style={{
                    backgroundColor: "#e0e0e0",
                    borderRadius: "8px",
                    overflow: "hidden",
                    height: "20px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${orderStreamLogs[orderStreamLogs.length - 1].progressPercentage}%`,
                      backgroundColor: "#0066cc",
                      transition: "width 0.5s ease-in-out",
                    }}
                  />
                </div>
                <p
                  style={{
                    textAlign: "right",
                    fontSize: "14px",
                    color: "#666",
                    marginTop: "4px",
                  }}
                >
                  {
                    orderStreamLogs[orderStreamLogs.length - 1]
                      .progressPercentage
                  }
                  % Completed
                </p>
              </div>
            )}

            {/* Stream Event Log */}
            <div
              style={{
                backgroundColor: "#1e1e1e",
                color: "#00ff66",
                fontFamily: "monospace",
                padding: "12px",
                borderRadius: "6px",
                maxHeight: "180px",
                overflowY: "auto",
              }}
            >
              {orderStreamLogs.map((log, index) => (
                <div key={index} style={{ marginBottom: "6px" }}>
                  [{log.timestamp}] gRPC Packet: {log.status} (
                  {log.progressPercentage}%)
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ color: "#888", fontStyle: "italic" }}>
            No active order to track. Click "Buy Now" on any item above to place
            an order and start streaming!
          </p>
        )}
      </section>
    </div>
  );
}
