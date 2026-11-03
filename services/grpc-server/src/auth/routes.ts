import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  AuthService,
  AuthResponseSchema,
  GetMeResponseSchema,
} from "../gen/proto/ecommerce/v1/auth_pb.js";
import { requireUser } from "./guard.js";
import { signToken, type AuthUser } from "./tokens.js";
import { AuthError, authenticate, findUser, registerUser } from "./users.js";

const ERROR_CODES: Record<AuthError["reason"], Code> = {
  invalid_input: Code.InvalidArgument,
  email_taken: Code.AlreadyExists,
  invalid_credentials: Code.Unauthenticated,
};

// Turn expected auth failures into the matching gRPC status code.
async function withAuthErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      throw new ConnectError(err.message, ERROR_CODES[err.reason]);
    }
    throw err;
  }
}

async function authResponse(user: AuthUser) {
  return create(AuthResponseSchema, { user, token: await signToken(user) });
}

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    async register(req) {
      console.log("[gRPC Microservice] Received Register RPC");
      return withAuthErrors(async () =>
        authResponse(await registerUser(req.email, req.password)),
      );
    },

    async login(req) {
      console.log("[gRPC Microservice] Received Login RPC");
      return withAuthErrors(async () =>
        authResponse(await authenticate(req.email, req.password)),
      );
    },

    async getMe(req, context) {
      const { id } = await requireUser(context);
      // The token may outlive the account, so check the user still exists.
      const user = await findUser(id);
      if (!user) {
        throw new ConnectError("Account no longer exists", Code.Unauthenticated);
      }
      return create(GetMeResponseSchema, { user });
    },
  });
}
