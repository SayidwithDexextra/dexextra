const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const HUB_INBOX = process.env.HUB_INBOX_ADDRESS;
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  // The failed deposit from the database
  const DEPOSIT = {
    chainId: 42161, // Arbitrum
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC
    amount: "100000", // 0.1 USDC
    depositId: "0x60720de494884bd21646aad855a51f56c1ff49b1d5ac350b7ea356f9018054b9"
  };

  console.log("=".repeat(60));
  console.log("RETRY: Credit failed deposit");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("HubBridgeInbox:", HUB_INBOX);
  console.log("\nDeposit details:");
  console.log("  Chain ID:", DEPOSIT.chainId);
  console.log("  User:", DEPOSIT.user);
  console.log("  Token:", DEPOSIT.token);
  console.log("  Amount:", DEPOSIT.amount, "(0.1 USDC)");
  console.log("  Deposit ID:", DEPOSIT.depositId);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  // First, check if HubBridgeInbox has BRIDGE_INBOX_ROLE
  const CollateralHubABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external",
    "function processedDepositIds(bytes32) view returns (bool)"
  ];
  
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  const hasRole = await hub.hasRole(BRIDGE_INBOX_ROLE, HUB_INBOX);
  console.log("HubBridgeInbox has BRIDGE_INBOX_ROLE:", hasRole);
  
  if (!hasRole) {
    throw new Error("HubBridgeInbox doesn't have BRIDGE_INBOX_ROLE - run fix-hub-inbox-role.js first");
  }
  
  // Check if deposit was already processed
  const alreadyProcessed = await hub.processedDepositIds(DEPOSIT.depositId);
  console.log("Deposit already processed:", alreadyProcessed);
  
  if (alreadyProcessed) {
    console.log("\n✅ Deposit was already processed!");
    return;
  }
  
  // The HubBridgeInbox takes: receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes calldata payload)
  // where payload = abi.encode(uint8 msgType, address user, address token, uint256 amount, bytes32 depositId)
  const HubInboxABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes calldata payload) external",
    "function remoteAppByDomain(uint64) view returns (bytes32)",
    "function collateralHub() view returns (address)"
  ];
  
  const inbox = new ethers.Contract(HUB_INBOX, HubInboxABI, wallet);
  
  // Check inbox configuration
  console.log("\n--- HubBridgeInbox Configuration ---");
  const hubAddress = await inbox.collateralHub();
  console.log("CollateralHub configured in inbox:", hubAddress);
  console.log("Expected CollateralHub:", COLLATERAL_HUB);
  console.log("Match:", hubAddress.toLowerCase() === COLLATERAL_HUB.toLowerCase());
  
  // Check remote app for Arbitrum
  const remoteApp = await inbox.remoteAppByDomain(DEPOSIT.chainId);
  console.log("Remote app for Arbitrum (42161):", remoteApp);
  
  // The relayer has BRIDGE_ENDPOINT_ROLE
  const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;
  if (!RELAYER_PK) {
    throw new Error("Missing RELAYER_PRIVATE_KEY in env");
  }
  
  const relayerWallet = new ethers.Wallet(RELAYER_PK, ethers.provider);
  console.log("\nRelayer wallet:", relayerWallet.address);
  
  const relayerBalance = await ethers.provider.getBalance(relayerWallet.address);
  console.log("Relayer balance:", ethers.formatEther(relayerBalance), "HYPE");
  
  // Check if relayer has BRIDGE_ENDPOINT_ROLE
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  const hasBridgeRole = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, relayerWallet.address);
  console.log("Relayer has BRIDGE_ENDPOINT_ROLE:", hasBridgeRole);
  
  if (!hasBridgeRole) {
    console.log("\n⚠️  Relayer doesn't have BRIDGE_ENDPOINT_ROLE - granting it...");
    const grantTx = await inbox.connect(wallet).grantRole(BRIDGE_ENDPOINT_ROLE, relayerWallet.address);
    await grantTx.wait();
    console.log("Role granted!");
  }
  
  // Connect inbox with relayer
  const inboxWithRelayer = inbox.connect(relayerWallet);
  
  console.log("\n--- Attempting to replay deposit via HubBridgeInbox ---");
  
  // The srcApp for Arbitrum outbox - needs to be bytes32 (padded address)
  const SPOKE_OUTBOX_ARBITRUM = process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM;
  console.log("Spoke Outbox Arbitrum:", SPOKE_OUTBOX_ARBITRUM);
  
  // Convert address to bytes32 (pad with zeros on the left)
  const srcApp = ethers.zeroPadValue(SPOKE_OUTBOX_ARBITRUM, 32);
  console.log("srcApp (bytes32):", srcApp);
  
  // Check if this matches the registered remote app
  if (remoteApp === ethers.ZeroHash) {
    console.log("\n⚠️  Remote app not set for Arbitrum - setting it now...");
    const setAppTx = await inbox.connect(wallet).setRemoteApp(DEPOSIT.chainId, srcApp);
    await setAppTx.wait();
    console.log("Remote app set!");
  } else if (remoteApp.toLowerCase() !== srcApp.toLowerCase()) {
    console.log("\n⚠️  Remote app mismatch!");
    console.log("  Registered:", remoteApp);
    console.log("  Expected:", srcApp);
  }
  
  // Encode payload: (uint8 msgType, address user, address token, uint256 amount, bytes32 depositId)
  const TYPE_DEPOSIT = 1;
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "address", "uint256", "bytes32"],
    [TYPE_DEPOSIT, DEPOSIT.user, DEPOSIT.token, DEPOSIT.amount, DEPOSIT.depositId]
  );
  console.log("Payload:", payload);
  
  try {
    const tx = await inboxWithRelayer.receiveMessage(
      DEPOSIT.chainId,
      srcApp,
      payload
    );
    console.log("TX hash:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("TX confirmed in block:", receipt.blockNumber);
    
    // Verify
    const processedAfter = await hub.processedDepositIds(DEPOSIT.depositId);
    console.log("Deposit processed after retry:", processedAfter);
    
    if (processedAfter) {
      console.log("\n✅ SUCCESS: Deposit credited!");
    }
  } catch (err) {
    console.log("\n❌ receiveMessage failed:", err.message);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
