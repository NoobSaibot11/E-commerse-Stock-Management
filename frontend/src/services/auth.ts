import { gql, tokenStore } from "../api";
import type { User } from "../types";

const USER_FIELDS = "id email role";

export type AuthMode = "login" | "register";

// Signs in or registers; the returned token is stored so api.ts sends it
// with every later request.
export async function authenticate(
  mode: AuthMode,
  email: string,
  password: string,
): Promise<User> {
  const data = await gql<Record<AuthMode, { token: string; user: User }>>(
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
  return data[mode].user;
}

// A stored token may have expired since the last visit; ask the server.
export async function restoreSession(): Promise<User | null> {
  if (!tokenStore.get()) return null;
  try {
    const data = await gql<{ me: User | null }>(
      `query Me { me { ${USER_FIELDS} } }`,
    );
    if (!data.me) tokenStore.clear();
    return data.me;
  } catch {
    tokenStore.clear();
    return null;
  }
}

export function signOut() {
  tokenStore.clear();
}
