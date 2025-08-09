ALTER TABLE vamm_markets 
ADD COLUMN IF NOT EXISTS metric_registry_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS centralized_vault_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS chain_id BIGINT DEFAULT 137,
ADD COLUMN IF NOT EXISTS factory_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS router_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS collateral_token_address VARCHAR(42);

-- Add indexes for the new searchable fields
CREATE INDEX IF NOT EXISTS idx_vamm_markets_metric_registry ON vamm_markets(metric_registry_address);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_centralized_vault ON vamm_markets(centralized_vault_address);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_chain_id ON vamm_markets(chain_id);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_factory ON vamm_markets(factory_address);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_router ON vamm_markets(router_address);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_collateral_token ON vamm_markets(collateral_token_address);

-- Add comments for documentation
COMMENT ON COLUMN vamm_markets.metric_registry_address IS 'Address of the MetricRegistry contract used for this market';
COMMENT ON COLUMN vamm_markets.centralized_vault_address IS 'Address of the CentralizedVault contract used for this market';
COMMENT ON COLUMN vamm_markets.chain_id IS 'Blockchain chain ID where contracts are deployed (e.g., 137 for Polygon)';
COMMENT ON COLUMN vamm_markets.factory_address IS 'Address of the MetricVAMMFactory that created this market';
COMMENT ON COLUMN vamm_markets.router_address IS 'Address of the MetricVAMMRouter for this market';
COMMENT ON COLUMN vamm_markets.collateral_token_address IS 'Address of the collateral token contract (e.g., USDC)';

-- Update existing records with system defaults where possible
-- Default to Polygon mainnet values from system_config
UPDATE vamm_markets SET 
  chain_id = 137,
  collateral_token_address = '0xA0b86a33E6843b496C5f87ac3e41abDB5eFB97Dc' -- USDC on Polygon
WHERE chain_id IS NULL;

-- Add constraints for address format validation
ALTER TABLE vamm_markets 
ADD CONSTRAINT check_metric_registry_address 
CHECK (metric_registry_address IS NULL OR metric_registry_address ~* '^0x[a-fA-F0-9]{40}$'),
ADD CONSTRAINT check_centralized_vault_address 
CHECK (centralized_vault_address IS NULL OR centralized_vault_address ~* '^0x[a-fA-F0-9]{40}$'),
ADD CONSTRAINT check_factory_address 
CHECK (factory_address IS NULL OR factory_address ~* '^0x[a-fA-F0-9]{40}$'),
ADD CONSTRAINT check_router_address 
CHECK (router_address IS NULL OR router_address ~* '^0x[a-fA-F0-9]{40}$'),
ADD CONSTRAINT check_collateral_token_address 
CHECK (collateral_token_address IS NULL OR collateral_token_address ~* '^0x[a-fA-F0-9]{40}$'),
ADD CONSTRAINT check_chain_id_valid 
CHECK (chain_id > 0);

-- Validation check
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vamm_markets' AND column_name = 'metric_registry_address') THEN
    RAISE EXCEPTION 'Migration failed: metric_registry_address column not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vamm_markets' AND column_name = 'centralized_vault_address') THEN
    RAISE EXCEPTION 'Migration failed: centralized_vault_address column not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vamm_markets' AND column_name = 'chain_id') THEN
    RAISE EXCEPTION 'Migration failed: chain_id column not created';
  END IF;
  
  RAISE NOTICE 'Migration 011 completed successfully - System integration columns added to vamm_markets';
END $$; 