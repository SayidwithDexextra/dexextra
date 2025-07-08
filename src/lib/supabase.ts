import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

console.log("Hi", supabaseUrl, supabaseKey)

export type Database = {
  public: {
    Tables: Record<string, unknown>
  }
} 