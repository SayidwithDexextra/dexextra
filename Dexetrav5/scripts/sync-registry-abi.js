const fs = require('fs');
const path = require('path');

async function main() {
  const artifactsDir = path.resolve(__dirname, '..', 'artifacts', 'src', 'diamond');
  const srcPath = path.join(artifactsDir, 'GlobalSessionRegistry.sol', 'GlobalSessionRegistry.json');
  const outPath = path.resolve(__dirname, '..', '..', 'src', 'lib', 'abis', 'GlobalSessionRegistry.json');

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Registry artifact not found: ${srcPath}. Run hardhat compile first.`);
  }
  const raw = fs.readFileSync(srcPath, 'utf8');
  const json = JSON.parse(raw);
  const abi = Array.isArray(json?.abi) ? json.abi : null;
  if (!abi) throw new Error('Invalid artifact: missing abi');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ abi }, null, 2) + '\n', 'utf8');
  console.log(`✅ Synced ABI -> ${outPath}`);
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});




