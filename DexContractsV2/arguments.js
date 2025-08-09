// Constructor arguments for SpecializedMetricVAMM at 0xc6d15Af1c2214b3f3e060fe4e95Dd5d0D1612053

module.exports = [
  "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93", // _centralVault
  "0x8f5200203c53c5821061D1f29249f10A5b57CA6A", // _metricRegistry
  "0x069331Cc5c881db1B1382416b189c198C5a2b356", // _factory
  "Financial", // _category
  [], // _allowedMetrics (empty array - may need to be populated)
  {
    maxLeverage: "50000000000000", // Max leverage as string to avoid BigInt issues
    tradingFeeRate: 30, // Trading fee rate: 30 basis points
    liquidationFeeRate: 500, // Estimated liquidation fee rate
    maintenanceMarginRatio: 500, // Estimated maintenance margin ratio
    initialReserves: "10000000000000000000000", // 10000 ETH in wei as string
    volumeScaleFactor: "1000000000000000000", // 1 ETH in wei as string
    startPrice: "50000000000000000000", // 50 ETH in wei as string
    isActive: true, // Template is active
    description: "Financial trading template",
  }, // _template
  "50000000000000000000", // _startPrice: 50.0 ETH in wei as string
];
