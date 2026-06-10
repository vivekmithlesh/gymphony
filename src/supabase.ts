import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both env vars are present (evaluated before the hard guard below).
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

// Strict Business-grade Guard: Production par immediately fail ho agar keys missing hon
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "CRITICAL CONFIG ERROR: Supabase environment variables are missing! " +
    "Please check your .env file or hosting provider dashboard setup."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { 'Cache-Control': 'no-cache' }
  }
});
