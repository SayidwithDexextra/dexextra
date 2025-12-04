const fs = require('fs');
const path = require('path');

function log(step, status, data) {
  try {
    console.log(JSON.stringify({
      area: 'abi_sync',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...(data && typeof data === 'object' ? data : {})
    }));
  } catch {}
}

async function main() {
  const facetNames = [
    'OBAdminFacet',
    'OBPricingFacet',
    'OBOrderPlacementFacet',
    'OBTradeExecutionFacet',
    'OBLiquidationFacet',
    'OBViewFacet',
    'OBSettlementFacet',
    'MetaTradeFacet',
  ];

  // Dexetrav5/scripts -> artifacts/src/diamond/facets
  const artifactsDir = path.resolve(__dirname, '..', 'artifacts', 'src', 'diamond', 'facets');
  // Dexetrav5/scripts -> ../../src/lib/abis/facets
  const destDir = path.resolve(__dirname, '..', '..', 'src', 'lib', 'abis', 'facets');

  log('init', 'start', { artifactsDir, destDir });

  if (!fs.existsSync(artifactsDir)) {
    log('check_artifacts_dir', 'error', { message: 'Artifacts directory not found', artifactsDir });
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  let synced = 0;
  const missing = [];
  const invalid = [];

  for (const name of facetNames) {
    const srcPath = path.join(artifactsDir, `${name}.sol`, `${name}.json`);
    const outPath = path.join(destDir, `${name}.json`);
    try {
      if (!fs.existsSync(srcPath)) {
        missing.push({ name, srcPath });
        continue;
      }
      const raw = fs.readFileSync(srcPath, 'utf8');
      const json = JSON.parse(raw);
      const abi = Array.isArray(json?.abi) ? json.abi : null;
      if (!abi) {
        invalid.push({ name, reason: 'missing_or_invalid_abi' });
        continue;
      }
      const output = JSON.stringify({ abi }, null, 2) + '\n';

      let shouldWrite = true;
      if (fs.existsSync(outPath)) {
        try {
          const existing = fs.readFileSync(outPath, 'utf8');
          if (existing === output) {
            shouldWrite = false;
          }
        } catch {}
      }

      if (shouldWrite) {
        fs.writeFileSync(outPath, output, 'utf8');
        log('write_facet', 'success', { name, outPath });
      } else {
        log('write_facet', 'success', { name, outPath, note: 'unchanged' });
      }
      synced += 1;
    } catch (e) {
      invalid.push({ name, reason: e?.message || String(e) });
    }
  }

  if (missing.length) log('missing_facets', 'error', { count: missing.length, missing });
  if (invalid.length) log('invalid_facets', 'error', { count: invalid.length, invalid });
  log('complete', 'success', { synced, total: facetNames.length });

  // Fail the pipeline if we couldn’t sync at least one facet, to prevent stale ABIs
  if (synced === 0 || missing.length || invalid.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  log('unhandled', 'error', { error: e?.message || String(e) });
  process.exitCode = 1;
});


