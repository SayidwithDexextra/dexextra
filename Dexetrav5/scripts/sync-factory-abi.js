/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function main() {
  const repoRoot = path.join(__dirname, "..", "..");
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "src",
    "FuturesMarketFactory.sol",
    "FuturesMarketFactory.json"
  );
  const destDir = path.join(repoRoot, "src", "lib", "abis");
  const destPath = path.join(destDir, "FuturesMarketFactory.json");

  if (!fs.existsSync(artifactPath)) {
    console.error("❌ Artifact not found:", artifactPath);
    process.exit(1);
  }
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const json = fs.readFileSync(artifactPath, "utf8");
  fs.writeFileSync(destPath, json);
  console.log("✅ Synced Factory ABI →", destPath);
}

main();







