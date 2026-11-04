import { GraphQLRequestError } from "./api";

// Server errors carry a message meant for people; anything else (network
// failure, bad response) gets a generic one so internals never show.
export function friendlyError(err: unknown, fallback: string): string {
  return err instanceof GraphQLRequestError ? err.message : fallback;
}

export function isSessionExpired(err: unknown): boolean {
  return err instanceof GraphQLRequestError && err.code === "UNAUTHENTICATED";
}
