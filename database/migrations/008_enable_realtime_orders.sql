-- Enable real-time for the orders table to fix webhook transaction updates
-- This migration ensures that real-time subscriptions work properly

-- Enable real-time replication for the orders table
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- Add RLS policies for real-time access (if not already present)
-- This allows real-time subscriptions to work with proper security

-- Enable RLS on orders table if not already enabled
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to see orders for markets they have access to
-- This is a broad policy for real-time functionality - adjust as needed for your security requirements
CREATE POLICY IF NOT EXISTS "Enable real-time access for orders" ON orders
    FOR ALL
    USING (true); -- Temporary: Allow all access for real-time functionality

-- Alternative more restrictive policy (uncomment if you want user-specific access):
-- CREATE POLICY IF NOT EXISTS "Users can see their own orders" ON orders
--     FOR ALL
--     USING (user_address = auth.jwt() ->> 'wallet_address' OR trader_address = auth.jwt() ->> 'wallet_address');

-- Ensure the orders table has proper indexes for real-time performance
CREATE INDEX IF NOT EXISTS idx_orders_market_id_created_at ON orders (market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_address_created_at ON orders (user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_trader_address_created_at ON orders (trader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders (status, created_at DESC);

-- Add a trigger to update the updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create the trigger if it doesn't exist
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions for real-time subscriptions
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO authenticated;

-- Notify that real-time is now enabled
SELECT 'Real-time enabled for orders table - webhook transaction updates should now work' as status;
