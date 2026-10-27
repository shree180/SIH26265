import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, loginRequest } from "./api";
import type { Capabilities, MeResponse, User } from "./types";

interface AuthValue {
  user: User | null;
  capabilities: Capabilities | null;
  unreadNotifications: number;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setUnreadNotifications: (count: number) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((data: MeResponse) => {
    setUser(data.user);
    setCapabilities(data.capabilities);
    setUnreadNotifications(data.unread_notifications);
  }, []);

  const refreshMe = useCallback(async () => {
    const data = await api.get<MeResponse>("/me");
    apply(data);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MeResponse>("/me")
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setCapabilities(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await loginRequest(email, password);
      await refreshMe();
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session may already be gone; clear local state regardless.
    }
    setUser(null);
    setCapabilities(null);
    setUnreadNotifications(0);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      capabilities,
      unreadNotifications,
      loading,
      signIn,
      signOut,
      refreshMe,
      setUnreadNotifications,
    }),
    [user, capabilities, unreadNotifications, loading, signIn, signOut, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
