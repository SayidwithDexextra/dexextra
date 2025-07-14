import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

console.log('supabaseUrl', supabaseUrl)
console.log('supabaseKey', supabaseKey)

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Database = {
  public: {
    Tables: Record<string, unknown>
  }
} 