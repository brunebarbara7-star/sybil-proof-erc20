/**
 * Gas / fee diagnostics for Redbelly Testnet.
 *
 * Queries:
 *  1. eth_gasPrice
 *  2. estimateFeesPerGas (EIP-1559 maxFeePerGas / maxPriorityFeePerGas)
 *  3. Latest block header (baseFeePerGas, gasLimit, gasUsed, utilization)
 *  4. eth_estimateGas for the actual SybilProofToken deployment
 *
 * Usage:
 *   npx hardhat run scripts/check-gas.ts
 */

import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeDeployData } from "viem";
import type { Abi } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolved in earlier runs — skip the registry round-trip here.
const PERMISSION_CONTRACT =
  "0x519ba1b48D571FD92FAF6FE4D20fe74Ca435B690" as const;
const TOKEN_NAME = "SybilProof Token";
const TOKEN_SYMBOL = "SPT";

const { viem } = await network.create({ network: "redbellyTestnet" });
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const hr = "=".repeat(60);
console.log(hr);
console.log("Gas / fee diagnostics — Redbelly Testnet");
console.log(hr);
console.log(`Deployer : ${deployer.account.address}`);

// ---------------------------------------------------------------------------
// 1. eth_gasPrice
// ---------------------------------------------------------------------------
console.log("\n[1] eth_gasPrice");
const gasPrice = await publicClient.getGasPrice();
console.log(`  raw        : ${gasPrice} wei`);
console.log(`  in Gwei    : ${gasPrice / 1_000_000_000n}`);

// ---------------------------------------------------------------------------
// 2. estimateFeesPerGas  (EIP-1559 hint from the client)
// ---------------------------------------------------------------------------
console.log("\n[2] estimateFeesPerGas (EIP-1559)");
try {
  const fees = await publicClient.estimateFeesPerGas();
  const mf = fees.maxFeePerGas;
  const mpf = fees.maxPriorityFeePerGas;
  console.log(
    `  maxFeePerGas         : ${mf} wei  (${mf != null ? mf / 1_000_000_000n : "n/a"} Gwei)`,
  );
  console.log(
    `  maxPriorityFeePerGas : ${mpf} wei  (${mpf != null ? mpf / 1_000_000_000n : "n/a"} Gwei)`,
  );
} catch (err: unknown) {
  console.log(
    `  failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Latest block — baseFeePerGas, gasLimit, gasUsed, utilisation
// ---------------------------------------------------------------------------
console.log("\n[3] Latest block");
const block = await publicClient.getBlock({ blockTag: "latest" });
const baseFee = block.baseFeePerGas;
const utilPct =
  block.gasLimit > 0n
    ? (block.gasUsed * 100n) / block.gasLimit
    : null;

console.log(`  number          : ${block.number}`);
console.log(
  `  baseFeePerGas   : ${baseFee} wei  (${baseFee != null ? baseFee / 1_000_000_000n : "n/a"} Gwei)`,
);
console.log(`  gasLimit        : ${block.gasLimit}`);
console.log(`  gasUsed         : ${block.gasUsed}`);
console.log(
  `  utilisation     : ${utilPct != null ? utilPct + "%" : "n/a"}`,
);

// ---------------------------------------------------------------------------
// 4. eth_estimateGas for the actual SybilProofToken deployment
// ---------------------------------------------------------------------------
console.log("\n[4] eth_estimateGas for SybilProofToken deployment");

const artifactPath = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "SybilProofToken.sol",
  "SybilProofToken.json",
);

if (!fs.existsSync(artifactPath)) {
  console.log(
    "  Artifact not found — run 'npx hardhat compile' first",
  );
} else {
  const artifact = JSON.parse(
    fs.readFileSync(artifactPath, "utf-8"),
  ) as { abi: Abi; bytecode: `0x${string}` };

  // encodeDeployData produces the full init-code (bytecode + ABI-encoded args).
  // Passing it as `data` with no `to` field triggers contract-creation estimation.
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [TOKEN_NAME, TOKEN_SYMBOL, PERMISSION_CONTRACT],
  });

  console.log(`  Init-code size  : ${(initCode.length - 2) / 2} bytes`);

  try {
    const estimatedGas = await publicClient.estimateGas({
      account: deployer.account,
      data: initCode,
    });
    console.log(`  estimateGas     : ${estimatedGas}`);

    // Cost projection using current baseFee
    if (baseFee != null) {
      const maxFee = baseFee * 2n + 1_000_000_000n;
      const cost = estimatedGas * maxFee;
      console.log(`\n  --- Cost projection (maxFeePerGas = baseFee×2 + 1 Gwei) ---`);
      console.log(`  maxFeePerGas    : ${maxFee} wei  (${maxFee / 1_000_000_000n} Gwei)`);
      console.log(`  Estimated cost  : ${cost} wei`);
      console.log(
        `                    ${Number(cost) / 1e18} RBNT  (at ${baseFee / 1_000_000_000n} Gwei base fee)`,
      );
    }
  } catch (err: unknown) {
    console.log(
      `  estimateGas failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log("  (Redbelly Testnet may not support eth_estimateGas for contract creation)");
  }
}

console.log("\n" + hr);
