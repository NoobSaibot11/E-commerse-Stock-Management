import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import { verifyToken, type AuthUser } from "./tokens.js";

// Called at the top of every protected handler. Reads
// "Authorization: Bearer <token>" from the request and returns its user,
// or rejects the call.

export async function requireUser(context: HandlerContext): Promise<AuthUser> {
  const header = context.requestHeader.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ConnectError("Sign in to continue", Code.Unauthenticated);
  }
  const user = await verifyToken(token);
  if (!user) {
    throw new ConnectError(
      "Your session is invalid or has expired. Sign in again.",
      Code.Unauthenticated,
    );
  }
  return user;
}

export async function requireAdmin(context: HandlerContext): Promise<AuthUser> {
  const user = await requireUser(context);
  if (user.role !== "ADMIN") {
    throw new ConnectError("Admin access required", Code.PermissionDenied);
  }
  return user;
}
