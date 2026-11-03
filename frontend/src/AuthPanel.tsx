import { useState, type FormEvent } from "react";
import type { User } from "./api";

interface AuthPanelProps {
  user: User | null;
  onSubmit: (
    mode: "login" | "register",
    email: string,
    password: string,
  ) => Promise<void>;
  onLogout: () => void;
}

export default function AuthPanel({ user, onSubmit, onLogout }: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const panelStyle = {
    border: "1px solid #ddd",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "32px",
    backgroundColor: "#fafafa",
  };

  if (user) {
    return (
      <section
        style={{
          ...panelStyle,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          Signed in as <strong>{user.email}</strong>{" "}
          <span style={{ color: "#666", fontSize: "14px" }}>({user.role})</span>
        </span>
        <button onClick={onLogout} style={{ cursor: "pointer", padding: "6px 12px" }}>
          Log out
        </button>
      </section>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(mode, email, password);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section style={panelStyle}>
      <h2 style={{ marginTop: 0 }}>
        {mode === "login" ? "Sign in (JWT via GraphQL)" : "Create an account"}
      </h2>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "8px", flex: "1 1 200px" }}
        />
        <input
          type="password"
          placeholder={mode === "register" ? "Password (8+ characters)" : "Password"}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: "8px", flex: "1 1 200px" }}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "8px 16px",
            backgroundColor: "#0066cc",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {mode === "login" ? "Sign in" : "Register"}
        </button>
      </form>
      {error && <p style={{ color: "red", marginBottom: 0 }}>{error}</p>}
      <p style={{ fontSize: "14px", color: "#666", marginBottom: 0 }}>
        {mode === "login" ? "No account yet? " : "Already registered? "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "#0066cc",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          {mode === "login" ? "Create one" : "Sign in instead"}
        </button>
      </p>
    </section>
  );
}
