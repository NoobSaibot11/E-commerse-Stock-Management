import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { friendlyError } from "../errors";
import type { AuthMode } from "../services/auth";

const COPY: Record<
  AuthMode,
  {
    title: string;
    subtitle: string;
    submit: string;
    switchText: string;
    switchLink: string;
    switchTo: string;
  }
> = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to browse and buy products.",
    submit: "Sign in",
    switchText: "New here?",
    switchLink: "Create an account",
    switchTo: "/signup",
  },
  register: {
    title: "Create your account",
    subtitle: "It only takes a moment.",
    submit: "Sign up",
    switchText: "Already have an account?",
    switchLink: "Sign in",
    switchTo: "/login",
  },
};

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const { submit } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy = COPY[mode];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await submit(mode, email, password);
      const from = (location.state as { from?: { pathname: string } } | null)
        ?.from?.pathname;
      navigate(from ?? "/", { replace: true });
    } catch (err) {
      setError(
        friendlyError(err, "We couldn't reach the shop. Please try again."),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>{copy.title}</h1>
      <p className="muted">{copy.subtitle}</p>

      <form onSubmit={handleSubmit} className="stack">
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "register" && (
            <small className="muted">At least 8 characters.</small>
          )}
        </label>
        {mode === "register" && (
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        )}

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Please wait…" : copy.submit}
        </button>
      </form>

      <p className="muted switch">
        {copy.switchText}{" "}
        <Link to={copy.switchTo} state={location.state}>
          {copy.switchLink}
        </Link>
      </p>
    </div>
  );
}
