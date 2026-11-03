import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { InventoryService } from "../../services/grpc-server/src/gen/proto/ecommerce/v1/inventory_pb";

const GRAPHQL_URL = "http://127.0.0.1:4000/graphql";
const GRPC_URL = "http://127.0.0.1:50051";
const TOKEN_KEY = "authToken";

export interface User {
  id: string;
  email: string;
  role: string;
}

// The JWT lives in localStorage so a refresh keeps you signed in. That's
// readable by any script on the page; an httpOnly cookie would avoid that
// but needs CSRF protection, which is more than this demo needs.
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage unavailable (e.g. private mode): stay signed in until reload.
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored to clear.
    }
  },
};

export class GraphQLRequestError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const authHeader = (): Record<string, string> => {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// POST a query to the GraphQL BFF, sending the token if signed in.
export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors?.length) {
    const [first] = json.errors;
    throw new GraphQLRequestError(first.message, first.extensions?.code);
  }
  return json.data as T;
}

// Adds the token to every direct gRPC call (the order-status stream).
const authInterceptor: Interceptor = (next) => (req) => {
  const token = tokenStore.get();
  if (token) req.header.set("Authorization", `Bearer ${token}`);
  return next(req);
};

// Initialize Connect-Web transport for direct gRPC-Web streaming calls from browser to gRPC server
export const grpcClient = createClient(
  InventoryService,
  createConnectTransport({ baseUrl: GRPC_URL, interceptors: [authInterceptor] }),
);
