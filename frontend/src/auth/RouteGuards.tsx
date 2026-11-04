import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext";

function Checking() {
  return <p className="muted center">Loading…</p>;
}

// Pages that need a signed-in user. Others are sent to /login and
// brought back afterwards.
export function RequireAuth() {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) return <Checking />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

// Login and sign-up pages: signed-in users go straight to the shop.
export function GuestOnly() {
  const { user, checking } = useAuth();
  if (checking) return <Checking />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
