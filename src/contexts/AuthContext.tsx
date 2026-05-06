import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  username: string | null;
  isAdmin: boolean;
  isPro: boolean;
  proGrandfathered: boolean;
  subscriptionStatus: string | null;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [proGrandfathered, setProGrandfathered] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  const isConfigured = isSupabaseConfigured();

  // Fetch the user's profile (which contains username) from the profiles table
  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('username, is_admin, is_pro, pro_grandfathered, subscription_status')
      .eq('id', userId)
      .single();
    setUsername(data?.username ?? null);
    setIsAdmin(data?.is_admin ?? false);
    setIsPro(data?.is_pro ?? false);
    setProGrandfathered(data?.pro_grandfathered ?? false);
    setSubscriptionStatus(data?.subscription_status ?? null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    // Listen for changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else { setUsername(null); setIsAdmin(false); }
    });

    return () => subscription.unsubscribe();
  }, [isConfigured]);

  const signUp = async (email: string, password: string, username: string) => {
    if (!isConfigured) return { error: 'Auth not configured' };
    if (username.length < 3) return { error: 'Username must be at least 3 characters' };

    // First check username availability
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.toLowerCase())
      .single();
    if (existing) return { error: 'Username already taken' };

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (!data.user) return { error: 'Signup failed' };

    // Create profile row
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        username: username.toLowerCase(),
        bankroll: 1000,
        created_at: new Date().toISOString(),
      });
    if (profileError) return { error: profileError.message };

    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    if (!isConfigured) return { error: 'Auth not configured' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (!isConfigured) return;
    await supabase.auth.signOut();
    setUsername(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, username, isAdmin, isPro, proGrandfathered, subscriptionStatus, signUp, signIn, signOut, refreshProfile, isConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
