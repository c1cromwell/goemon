/**
 * Auth + identity context for the customer portal.
 *
 * Holds the session (user + tier profile), exposes login/register/passkey/logout,
 * and provides route guards. Tier drives feature gating: SmartChat needs Tier 2,
 * marketplace eligibility is per-listing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  userApi,
  getUserToken,
  setUserToken,
  clearUserToken,
  type Me,
  type IdentityProfile,
} from "../api/client";
import { loginWithPasskey } from "../lib/webauthn";

interface AuthState {
  me: Me | null;
  profile: IdentityProfile | null;
  tier: number;
  loading: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  loginPassword: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  loginPasskey: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<IdentityProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getUserToken()) {
      setMe(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const [m, p] = await Promise.all([
        userApi.me(),
        userApi.profile().catch(() => null),
      ]);
      setMe(m);
      setProfile(p);
    } catch {
      // Token invalid/expired — drop it.
      clearUserToken();
      setMe(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loginPassword = useCallback(
    async (email: string, password: string) => {
      const { token } = await userApi.loginPassword(email, password);
      setUserToken(token);
      await load();
    },
    [load]
  );

  const register = useCallback(
    async (email: string, password: string, fullName?: string) => {
      const { token } = await userApi.register(email, password, fullName);
      setUserToken(token);
      await load();
    },
    [load]
  );

  const loginPasskey = useCallback(
    async (email: string) => {
      await loginWithPasskey(email); // stores token
      await load();
    },
    [load]
  );

  const logout = useCallback(() => {
    clearUserToken();
    setMe(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      me,
      profile,
      tier: profile?.tier ?? 0,
      loading,
      authenticated: !!me,
      refresh: load,
      loginPassword,
      register,
      loginPasskey,
      logout,
    }),
    [me, profile, loading, load, loginPassword, register, loginPasskey, logout]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Gate a route behind an authenticated session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { authenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullscreenSpinner />;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Gate a route behind a minimum tier; redirects to onboarding if below. */
export function RequireTier({ tier, children }: { tier: number; children: ReactNode }) {
  const { tier: current, loading, authenticated } = useAuth();
  if (loading) return <FullscreenSpinner />;
  if (!authenticated) return <Navigate to="/login" replace />;
  if (current < tier) return <Navigate to="/onboarding" replace state={{ needTier: tier }} />;
  return <>{children}</>;
}

function FullscreenSpinner() {
  return (
    <div className="center">
      <span className="spinner" />
    </div>
  );
}
