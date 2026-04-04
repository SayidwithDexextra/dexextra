const { ethers } = require("hardhat");
async function main() {
  const market = (process.env.MARKET_ADDRESS || "").trim();
  if (!market) throw new Error("Set MARKET_ADDRESS");
  const [signer] = await ethers.getSigners();
  console.log("Signer:", await signer.getAddress());
  console.log("Market:", market);

  const bondUsdc = 50000000n; // 50 USDC (6 decimals)
  const slashRecipient = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";

  const lc = await ethers.getContractAt(
    [
      "function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external",
      "function getChallengeBondConfig() view returns (uint256 bondAmount, address slashRecipient)",
    ],
    market, signer
  );
  const tx = await lc.setChallengeBondConfig(bondUsdc, slashRecipient);
  console.log("tx:", tx.hash);
  await tx.wait();

  const cfg = await lc.getChallengeBondConfig();
  console.log("Bond:", cfg.bondAmount.toString(), "Slash recipient:", cfg.slashRecipient);
  console.log("Done");
}
main().then(() => process.exit(0)).catch(e => { console.error(e?.message || e); process.exit(1); });
