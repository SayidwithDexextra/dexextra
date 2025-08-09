-- =============================================
-- Migration: 005_create_vamm_markets_table.sql
-- Fix the missing vamm_markets table issue
-- =============================================

-- 1. CREATE THE TABLE STRUCTURE
CREATE TABLE IF NOT EXISTS vamm_markets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  description TEXT,
  category TEXT[] DEFAULT '{}',
  oracle_address VARCHAR(42) NOT NULL,
  initial_price NUMERIC(36,18) NOT NULL,
  price_decimals INTEGER DEFAULT 8,
  banner_image_url TEXT,
  icon_image_url TEXT,
  supporting_photo_urls TEXT[] DEFAULT '{}',
  deployment_fee NUMERIC(36,6) DEFAULT 0.1,
  is_active BOOLEAN DEFAULT true,
  user_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  vamm_address VARCHAR(42),
  vault_address VARCHAR(42),
  market_id VARCHAR(255),
  transaction_hash VARCHAR(66),
  deployment_status VARCHAR(20) DEFAULT 'pending',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_oracle_address CHECK (oracle_address ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT check_user_address CHECK (user_address ~* '^0x[a-fA-F0-9]{40}$')
);

-- 2. CREATE INDEXES
CREATE INDEX IF NOT EXISTS idx_vamm_markets_symbol ON vamm_markets(symbol);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_status ON vamm_markets(deployment_status);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_user ON vamm_markets(user_address);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_active ON vamm_markets(is_active);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_created ON vamm_markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_vamm_address ON vamm_markets(vamm_address);

-- 3. CREATE UPDATED_AT FUNCTION AND TRIGGER
-- First create the function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Then create the trigger (drop if exists first)
DROP TRIGGER IF EXISTS update_vamm_markets_updated_at ON vamm_markets;
CREATE TRIGGER update_vamm_markets_updated_at 
  BEFORE UPDATE ON vamm_markets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. INSERT SAMPLE DATA (skip if records already exist)
INSERT INTO vamm_markets (id, symbol, description, category, oracle_address, initial_price, price_decimals, banner_image_url, icon_image_url, supporting_photo_urls, deployment_fee, is_active, user_address, created_at, vamm_address, vault_address, market_id, transaction_hash, deployment_status) VALUES 
('19698831-d126-443b-9cba-20551cc3121e', 'BTC', 'Bitcoin futures trading market - Long or short Bitcoin with leverage', '{"cryptocurrency","bitcoin"}', '0x742d35Cc6635C0532925a3b8D9B5A7b8C6B9D0e1', '95420.25000000', 8, 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800', 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=200', '{"https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400"}', '0.10000000', true, '0x60D4a8b8a9b7f96D7e9c8E5f2796B1a2C3d4E5f6', '2025-07-11 21:16:44.247+00', '0x3e7bc93471a1b4c88c5e7a86a7a6c7d8e9f0a1b3', '0x4f8cd93471a1b4c88c5e7a86a7a6c7d8e9f0a1b4', '0x2345678901bcdef12345678901bcdef12345678901bcdef12345678901bcdef1', null, 'completed'),

('1a8d6b91-db37-4bb7-82d4-b4fd6e49b2a1', 'EUR', 'EUR EUR EUR EUR EUR EUR EUR', '{"crypto","forex"}', '0xB65258446bd83916Bd455bB3dBEdCb9BA106d551', '100.00000000', 8, 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/banner/1752335264680-wrop5qe29nl.png', 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752335273877-s3uxg8cfazj.jpeg', '{}', '0.00000000', true, '0x14a2b07eec1f8d1ef0f9deeef9a352c432269cdb', '2025-07-12 15:48:27.29+00', '0x6bd816cbCFC91C48970b6efCB5A73A51105c275E', '0x8bf80A4f7EB0B9aA37F6ECFEd67FaeaC183393d3', null, null, 'pending'),

('24db6e82-ea63-41d9-8853-68f2e3201e1c', 'GOLDV4', 'GOLDV4', '{"crypto","forex","commodities"}', '0xB4c4608eF2c674455a0495729b61577eE85a1bD8', '1.00000000', 8, 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/banner/1752608871100-m6vf5bj5k9.png', 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752608879138-xv9i75pez9k.gif', '{}', '0.10000000', true, '0x14a2b07eec1f8d1ef0f9deeef9a352c432269cdb', '2025-07-15 19:49:15.166+00', '0xc6220F6bdCe01E85088B7e7b64e9425b86e3aB04', '0x66cd6b6E9ebEfd83548BFfC7d0Fe525C40996fFe', '0x8da5285f5a2e00ee63aa0bc1df440cfea35dee0e5774540ce31559dc1cd190a8', '0xdcf1872c3cc1760c64f4021526b69556675dffe48c7c8da052ca61a227c8732f', 'deployed'),

('400a2d7f-34f3-4112-a530-40c322569440', 'GOLD', 'Traditional Futures Market - Bilateral Price Impact System', '{"futures","traditional","bilateral","test"}', '0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711', '1.00000000', 18, 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaXhucGQyOWdhbHUweDI2dGNxNjE1OGFrdGpwcWVyYWFjdmhramk2NSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3ohzdLG8AHzwgZkRmE/giphy.gif', 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaXhucGQyOWdhbHUweDI2dGNxNjE1OGFrdGpwcWVyYWFjdmhramk2NSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3ohzdLG8AHzwgZkRmE/giphy.gif', '{}', '0.00000000', true, '0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb', '2025-07-18 02:48:58.264+00', '0x487f1baE58CE513B39889152E96Eb18a346c75b1', '0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e', 'traditional_futures_1752806938264', null, 'deployed'),

('4b7a3cb6-169f-4d4e-9ac3-58e3f9d88ac5', 'AAPL', 'Apple Inc. stock futures - Trade AAPL price movements', '{"stocks","technology"}', '0x742d35Cc6635C0532925a3b8D9B5A7b8C6B9D0e1', '195.89000000', 8, 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800', 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=200', '{}', '0.10000000', true, '0x60D4a8b8a9b7f96D7e9c8E5f2796B1a2C3d4E5f6', '2025-07-11 21:16:44.248+00', '0x7i1fg93471a1b4c88c5e7a86a7a6c7d8e9f0a1b7', '0x8j2gh93471a1b4c88c5e7a86a7a6c7d8e9f0a1b8', '0x4567890123def1234567890123def1234567890123def1234567890123def123', null, 'completed'),

('4d57a1fd-b349-4b92-b13c-a54d68e4a0b2', 'GoldV1', '🟡 Gold Futures Market on Base

The Gold Futures Market on Base is a decentralized trading protocol that enables users to speculate on the future price of gold using smart contracts and tokenized positions. Built on Base, Ethereum''s Layer 2 network optimized for speed and low fees, the platform offers secure, real-time, and censorship-resistant exposure to gold price movements—without the need to hold physical gold or trust intermediaries.

🔧 Key Features
1. Tokenized Futures Contracts
Users can take LONG or SHORT positions on the price of gold by minting synthetic tokens representing each side of the trade. Each market has a fixed expiry date and settles based on a trusted oracle price feed for gold (e.g., Chainlink or Coinbase Oracle).

2. Virtual AMM (vAMM) or Order Book Support
The platform can use a vAMM mechanism or a decentralized order book to match buyers and sellers of LONG/SHORT positions. This enables price discovery without needing a real pool of assets.

3. Decentralized Oracle Integration
Price data is fetched periodically from verified, tamper-proof oracles. The final settlement of the contract is based on the gold price pushed to the chain at expiry.

4. Low-Cost, High-Speed Trading
Deployed on Base, users benefit from fast transactions and ultra-low gas fees while staying anchored to Ethereum''s security guarantees.', '{"Gold","Markets"}', '0xB65258446bd83916Bd455bB3dBEdCb9BA106d551', '3333.00000000', 8, 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExNzJ5cHY4Nm55azdnc2t0MGd1cTV3OWxkYWh5bHpuYzVwZnpvNnhtMyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/pVnfc9v3xjh5K/giphy.gif', 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWdrZGRnM20xeGhrZmw2M2hodzZmYWJkZHE1NzZ2bGJsYmNqYjRmYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bYPfSSrHKSQNrpXpOR/giphy.gif', '{}', '0.00000000', true, '0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb', '2025-07-11 15:59:58.447641+00', '0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0', '0x4fE813c0042f444D19e950719c2ec415B87b56dA', '0x5b765f8b7783bd3206e38101d0eca0fbb07f905b9ed6aa79fb4003dbc8914c94', null, 'deployed'),

('8ec51d74-fe2c-4ab9-ae52-cd2ce321d41c', 'GOLDV2', 'Gold V2', '{"crypto","commodities"}', '0xBbD78770a3eE4E96bcBDf6cD2cf406E33C0799F7', '100.00000000', 8, 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/banner/1752368080651-8p93gesnu1x.jpg', 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752368107553-mw07etnr47a.png', '{}', '0.00000000', true, '0x14a2b07eec1f8d1ef0f9deeef9a352c432269cdb', '2025-07-13 00:55:50.704+00', '0x4eAe52fe16BfD10bda0f6d7d354EC4a23188fce8', '0x74817142DC7BB31425Da8972504f6c93c66F40f4', '0x3126e399eac91adfc34c2691a4b0fb050d99d457f50d08cc994fee5f1a8adc98', null, 'deployed'),

('9e2774f5-c369-4877-a5cb-3aa3f976360c', 'GOLDV3', 'GoldV3', '{"crypto","forex","commodities"}', '0xBbD78770a3eE4E96bcBDf6cD2cf406E33C0799F7', '100.00000000', 8, 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/banner/1752540024369-saq5o4unfn.png', 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752540045508-hrvho461a64.gif', '{}', '0.10000000', true, '0x14a2b07eec1f8d1ef0f9deeef9a352c432269cdb', '2025-07-15 00:41:37.706+00', '0x49325a53DFbF0CE08E6E2D12653533c6fC3F9673', '0x82045733a87751b759e2AefF4A405938829c4CC9', '0x8d08525db600f4758b52c4edfe387c66dc91734980a255bbb5cd75c676cfe4c6', '0x912228f9e96142d4b95c5ecc5d07379f31efdf602b8de95ea1ecd4c914649fab', 'deployed'),

('f7424fd9-f253-47b1-bb2f-a5201dd72ce6', 'ETH', 'Ethereum futures trading market - Trade ETH price movements with leverage', '{"cryptocurrency","ethereum"}', '0x742d35Cc6635C0532925a3b8D9B5A7b8C6B9D0e1', '3420.75000000', 8, 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800', 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=200', '{}', '0.10000000', true, '0x60D4a8b8a9b7f96D7e9c8E5f2796B1a2C3d4E5f6', '2025-07-11 21:16:44.248+00', '0x5g9de93471a1b4c88c5e7a86a7a6c7d8e9f0a1b5', '0x6h0ef93471a1b4c88c5e7a86a7a6c7d8e9f0a1b6', '0x3456789012cdef123456789012cdef123456789012cdef123456789012cdef12', null, 'completed')
ON CONFLICT (id) DO NOTHING; 