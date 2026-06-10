import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "viewer" | null;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | undefined>(undefined);

const ROLE_CACHE_KEY = "lockerops.auth.role.v1";

function readCachedRole(): { userId: string; role: Role } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCachedRole(userId: string, role: Role) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ userId, role })); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser((prev) => {
        const next = s?.user ?? null;
        if (prev?.id === next?.id) return prev;
        return next;
      });
      if (s?.user) {
        setTimeout(() => fetchRole(s.user.id), 0);
      } else {
        setRole(null);
        if (typeof window !== "undefined") {
          try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* ignore */ }
        }
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        // Hydrate role from cache instantly so PageGuard doesn't blank.
        const cached = readCachedRole();
        if (cached && cached.userId === data.session.user.id) setRole(cached.role);
        fetchRole(data.session.user.id);
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function fetchRole(userId: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    const r = (data?.role as Role) ?? "viewer";
    setRole(r);
    writeCachedRole(userId, r);
  }

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Block sign-in if no role has been assigned (account pending admin approval).
    if (data.user) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (!roleRow) {
        await supabase.auth.signOut();
        return { error: "Your account is pending admin approval. Please try again later." };
      }
    }
    return {};
  };

  const signUp: AuthCtx["signUp"] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return error ? { error: error.message } : {};
  };

  const signOut = async () => {
    try {
      const { clearReconcileState } = await import("@/lib/reconcile-store");
      await clearReconcileState();
    } catch { /* ignore */ }
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
