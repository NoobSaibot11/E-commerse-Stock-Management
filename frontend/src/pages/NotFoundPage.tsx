import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="card auth-card">
      <h1>Page not found</h1>
      <p className="muted">That page doesn't exist.</p>
      <Link to="/" className="btn btn-primary">
        Back to the shop
      </Link>
    </div>
  );
}
