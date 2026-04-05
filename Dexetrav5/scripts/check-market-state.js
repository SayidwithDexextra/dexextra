const { ethers } = require("hardhat");

const CORE_VAULT = "0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1";

const ABI = [
  "function getLifecycleState() external view returns (uint8)",
  "function isSettled() external view returns (bool)",
  "function getActiveChallengeInfo() external view returns (bool active, address challengerAddr, uint256 challengedPriceVal, uint256 bondEscrowed, bool resolved, bool won)",
  "function getProposedSettlementPrice() external view returns (uint256 price, uint256 timestamp, bool proposed)",
  "function getSettlementTimestamp() external view returns (uint256)",
  "function getMarkPrice() external view returns (uint256)",
  "function syncLifecycle() external returns (uint8 previousState, uint8 newState)",
  "function isInSettlementChallengeWindow() external view returns (bool)",
  "function getChallengeWindowEnd() external view returns (uint256)",
  "function challengeWindowStart() external view returns (uint256)",
  "function marketId() external view returns (bytes32)",
];

async function main() {
  const marketAddress = process.env.MARKET_ADDRESS || "0xC1f81d08239CBbe5a8152C8dBa99539780Ad4560";
  
  const [signer] = await ethers.getSigners();
  const market = new ethers.Contract(marketAddress, ABI, signer);

  console.log(`\n=== Market State: ${marketAddress} ===\n`);
  
  try {
    const lifecycleState = await market.getLifecycleState();
    console.log("Lifecycle State:", lifecycleState, ["Unsettled", "Rollover", "ChallengeWindow", "Settled"][Number(lifecycleState)]);
  } catch (e) { console.log("getLifecycleState error:", e.message); }

  try {
    const isSettled = await market.isSettled();
    console.log("isSettled:", isSettled);
  } catch (e) { console.log("isSettled error:", e.message); }

  try {
    const [active, challenger, challengedPrice, bondEscrowed, resolved, won] = await market.getActiveChallengeInfo();
    console.log("\nChallenge Info:");
    console.log("  active:", active);
    console.log("  challenger:", challenger);
    console.log("  challengedPrice:", ethers.formatUnits(challengedPrice, 6));
    console.log("  bondEscrowed:", ethers.formatUnits(bondEscrowed, 6));
    console.log("  resolved:", resolved);
    console.log("  challengerWon:", won);
  } catch (e) { console.log("getActiveChallengeInfo error:", e.message); }

  try {
    const [price, ts, proposed] = await market.getProposedSettlementPrice();
    console.log("\nProposed Settlement:");
    console.log("  price:", ethers.formatUnits(price, 6));
    console.log("  timestamp:", ts > 0 ? new Date(Number(ts) * 1000).toISOString() : "N/A");
    console.log("  proposed:", proposed);
  } catch (e) { console.log("getProposedSettlementPrice error:", e.message); }

  try {
    const settlementTs = await market.getSettlementTimestamp();
    console.log("\nSettlement Timestamp:", new Date(Number(settlementTs) * 1000).toISOString());
  } catch (e) { console.log("getSettlementTimestamp error:", e.message); }

  try {
    const markPrice = await market.getMarkPrice();
    console.log("Mark Price:", ethers.formatUnits(markPrice, 6));
  } catch (e) { console.log("getMarkPrice error:", e.message); }

  try {
    const inChallengeWindow = await market.isInSettlementChallengeWindow();
    console.log("\nisInSettlementChallengeWindow:", inChallengeWindow);
  } catch (e) { console.log("isInSettlementChallengeWindow error:", e.message); }

  try {
    const challengeWindowEnd = await market.getChallengeWindowEnd();
    console.log("Challenge Window End:", new Date(Number(challengeWindowEnd) * 1000).toISOString());
    console.log("  Window expired:", Date.now() > Number(challengeWindowEnd) * 1000);
  } catch (e) { console.log("getChallengeWindowEnd error:", e.message); }

  // Check CoreVault state
  const VAULT_ABI = [
    "function marketSettled(bytes32 marketId) external view returns (bool)",
    "function marketMarkPrices(bytes32 marketId) external view returns (uint256)",
  ];
  const vault = new ethers.Contract(CORE_VAULT, VAULT_ABI, signer);
  
  try {
    const marketId = await market.marketId();
    console.log("\nMarket ID:", marketId);
    
    const vaultSettled = await vault.marketSettled(marketId);
    console.log("CoreVault.marketSettled:", vaultSettled);
    
    const vaultPrice = await vault.marketMarkPrices(marketId);
    console.log("CoreVault.marketMarkPrices:", ethers.formatUnits(vaultPrice, 6));
  } catch (e) { console.log("CoreVault check error:", e.message); }
}

main().catch(console.error);
