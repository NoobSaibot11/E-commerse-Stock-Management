import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  authenticate,
  restoreSession,
  signOut,
  type AuthMode,
} from "../services/auth";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  // True until a saved session has been checked on first load.
  checking: boolean;
  submit: (mode: AuthMode, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    restoreSession()
      .then(setUser)
      .finally(() => setChecking(false));
  }, []);

  const submit = useCallback(
    async (mode: AuthMode, email: string, password: string) => {
      setUser(await authenticate(mode, email, password));
    },
    [],
  );

  const logout = useCallback(() => {
    signOut();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, checking, submit, logout }),
    [user, checking, submit, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
