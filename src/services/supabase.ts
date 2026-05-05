// SECURITY NOTE: Supabase anon keys are designed to be public.
// All security comes from Row Level Security (RLS) policies set up
// on the Supabase dashboard. NEVER use the service_role key here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Guard against missing env vars — createClient throws on empty strings.
// We expose a stub that errors only when actually called.
function makeStubClient(): SupabaseClient {
  const err = () => {
    throw new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify env vars and redeploy.');
  };
  return new Proxy({} as SupabaseClient, { get: err });
}

export const supabase: SupabaseClient =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : makeStubClient();

export const isSupabaseConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
