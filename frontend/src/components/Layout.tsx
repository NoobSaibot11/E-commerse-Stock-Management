import { Link, Outlet } from "react-router";
import { useAuth } from "../auth/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="page">
      <header className="site-header">
        <Link to="/" className="brand">
          🛒 Stock Shop
        </Link>
        {user && (
          <div className="user-bar">
            <span className="muted">
              {user.email}
              {user.role === "ADMIN" && <span className="badge">Admin</span>}
            </span>
            <button className="btn btn-ghost" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
