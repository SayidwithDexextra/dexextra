import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export const supabaseAdmin = createClient(
  // Prefer server-side URL/key, fall back to public only if necessary
  (env.SUPABASE_URL as unknown as string) || (env.NEXT_PUBLIC_SUPABASE_URL as unknown as string),
  (env.SUPABASE_SERVICE_ROLE_KEY as unknown as string) || (env.SUPABASE_ANON_KEY as unknown as string) || (env.NEXT_PUBLIC_SUPABASE_ANON_KEY as unknown as string),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);