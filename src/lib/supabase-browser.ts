'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserSupabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (browserSupabase) return browserSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  browserSupabase = createClient(url, anon);
  return browserSupabase;
}

export default getSupabaseClient();


