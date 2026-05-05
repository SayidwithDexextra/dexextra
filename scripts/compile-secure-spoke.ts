#!/usr/bin/env tsx
/**
 * Compile Secure Spoke Contracts using solc
 * 
 * This script compiles the SecureSpokeVaultV2 and SecureSpokeBridgeInboxV2 contracts
 * and outputs the artifacts to contracts/secure-spoke/artifacts/
 * 
 * Usage:
 *   npx tsx scripts/compile-secure-spoke.ts
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CONTRACTS_DIR = path.resolve(process.cwd(), "contracts/secure-spoke");
const ARTIFACTS_DIR = path.resolve(CONTRACTS_DIR, "artifacts");
const OZ_DIR = path.resolve(process.cwd(), "node_modules/@openzeppelin/contracts");

// Check if OpenZeppelin contracts are installed
if (!fs.existsSync(OZ_DIR)) {
  console.log("Installing @openzeppelin/contracts...");
  execSync("npm install @openzeppelin/contracts@^5.0.0", { stdio: "inherit" });
}

// Create artifacts directory
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════╗");
console.log("║         COMPILE SECURE SPOKE CONTRACTS                                   ║");
console.log("╚══════════════════════════════════════════════════════════════════════════╝");
console.log("");

const contracts = [
  "SecureSpokeVaultV2.sol",
  "SecureSpokeBridgeInboxV2.sol",
];

for (const contractFile of contracts) {
  const contractPath = path.join(CONTRACTS_DIR, contractFile);
  const contractName = contractFile.replace(".sol", "");
  
  console.log(`Compiling ${contractFile}...`);
  
  if (!fs.existsSync(contractPath)) {
    console.error(`  ❌ File not found: ${contractPath}`);
    continue;
  }
  
  try {
    // Use solcjs to compile
    const solcInput = {
      language: "Solidity",
      sources: {
        [contractFile]: {
          content: fs.readFileSync(contractPath, "utf8"),
        },
      },
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        outputSelection: {
          "*": {
            "*": ["abi", "evm.bytecode.object"],
          },
        },
      },
    };
    
    // Write input to temp file
    const inputPath = path.join(ARTIFACTS_DIR, `${contractName}-input.json`);
    fs.writeFileSync(inputPath, JSON.stringify(solcInput, null, 2));
    
    // Try to use solc via npx
    const outputPath = path.join(ARTIFACTS_DIR, `${contractName}-output.json`);
    
    try {
      execSync(
        `npx solc --standard-json --base-path . --include-path node_modules < ${inputPath} > ${outputPath}`,
        { 
          cwd: process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      
      const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      
      if (output.errors) {
        const errors = output.errors.filter((e: any) => e.severity === "error");
        if (errors.length > 0) {
          console.error(`  ❌ Compilation errors:`);
          errors.forEach((e: any) => console.error(`     ${e.message}`));
          continue;
        }
      }
      
      // Extract ABI and bytecode
      const contractOutput = output.contracts?.[contractFile]?.[contractName];
      if (contractOutput) {
        const artifact = {
          contractName,
          abi: contractOutput.abi,
          bytecode: "0x" + contractOutput.evm.bytecode.object,
        };
        
        const artifactPath = path.join(ARTIFACTS_DIR, `${contractName}.json`);
        fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
        console.log(`  ✅ Compiled: ${artifactPath}`);
      } else {
        console.error(`  ❌ Contract not found in output`);
      }
    } catch (solcError: any) {
      console.error(`  ❌ solc failed: ${solcError.message}`);
      console.log("");
      console.log("  Alternative: Use Foundry or Hardhat to compile:");
      console.log("    forge build --contracts contracts/secure-spoke");
      console.log("  or");
      console.log("    npx hardhat compile");
    }
    
    // Clean up temp files
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    
  } catch (e: any) {
    console.error(`  ❌ Error: ${e.message}`);
  }
}

console.log("");
console.log("Done!");
console.log("");
console.log("If compilation failed, you can also use Foundry:");
console.log("  1. Install Foundry: curl -L https://foundry.paradigm.xyz | bash");
console.log("  2. Run: cd contracts/secure-spoke && forge init --no-commit && forge build");
console.log("");
