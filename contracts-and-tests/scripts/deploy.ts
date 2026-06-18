/**
 * Deploy SybilProofToken to Redbelly Testnet (chain ID 153).
 *
 * Usage (after filling in .env):
 *   npm run deploy:testnet
 *   — or —
 *   npx hardhat run scripts/deploy.ts
 *
 * What this script does:
 *   1. Calls getContractAddress("permission") on the Bootstrap Registry
 *      (0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5) to resolve the current
 *      Permission Contract address on Redbelly Testnet.
 *   2. Deploys SybilProofToken with that address as the eligibilityContract.
 *   3. Writes the deployment record to deployments/redbellyTestnet.json.
 */

import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeDeployData } from "viem";
import type { Abi } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Bootstrap Registry — same address on every Redbelly network.
// Calling getContractAddress("permission") returns the chain-specific
// Permission Contract that backs isAllowed().
// ---------------------------------------------------------------------------
const BOOTSTRAP_REGISTRY = "0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5" as const;

const BOOTSTRAP_REGISTRY_ABI = [
  {
    inputs: [{ internalType: "string", name: "contractName", type: "string" }],
    name: "getContractAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// Token parameters
// ---------------------------------------------------------------------------
const TOKEN_NAME = "SybilProof Token";
const TOKEN_SYMBOL = "SPT";

// ---------------------------------------------------------------------------
// Connect to Redbelly Testnet
// ---------------------------------------------------------------------------
const { viem } = await network.create({ network: "redbellyTestnet" });
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

console.log("=".repeat(60));
console.log("SybilProofToken — Redbelly Testnet deployment");
console.log("=".repeat(60));
console.log(`Deployer : ${deployer.account.address}`);

// ---------------------------------------------------------------------------
// Step 1: Resolve Permission Contract from Bootstrap Registry
// ---------------------------------------------------------------------------
console.log("\n[1/3] Resolving Permission Contract via Bootstrap Registry...");
console.log(`      Registry : ${BOOTSTRAP_REGISTRY}`);

const permissionContractAddress = await publicClient.readContract({
  address: BOOTSTRAP_REGISTRY,
  abi: BOOTSTRAP_REGISTRY_ABI,
  functionName: "getContractAddress",
  args: ["permission"],
});

console.log(`      Resolved : ${permissionContractAddress}`);

if (
  permissionContractAddress ===
  "0x0000000000000000000000000000000000000000"
) {
  throw new Error(
    "Bootstrap Registry returned zero address for 'permission' — check network/chainId before deploying",
  );
}

// ---------------------------------------------------------------------------
// Step 2: Deploy SybilProofToken
// ---------------------------------------------------------------------------
console.log("\n[2/3] Deploying SybilProofToken...");
console.log(`      name                : "${TOKEN_NAME}"`);
console.log(`      symbol              : "${TOKEN_SYMBOL}"`);
console.log(`      eligibilityContract : ${permissionContractAddress}`);

// Read compiled artifact from disk (produced by `hardhat compile`).
const artifactPath = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "SybilProofToken.sol",
  "SybilProofToken.json",
);

if (!fs.existsSync(artifactPath)) {
  throw new Error(
    `Artifact not found at ${artifactPath} — run "npx hardhat compile" first`,
  );
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8")) as {
  abi: Abi;
  bytecode: `0x${string}`;
};

// encodeDeployData produces the full init-code (bytecode + ABI-encoded
// constructor args) so the gas estimate below reflects this exact deployment,
// not a generic guess.
const initCode = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [TOKEN_NAME, TOKEN_SYMBOL, permissionContractAddress],
});

const rawEstimatedGas = await publicClient.estimateGas({
  account: deployer.account.address,
  data: initCode,
});
// +10% buffer — state (and therefore gas cost) can shift slightly between
// this estimate and the actual send.
const gasLimit = (rawEstimatedGas * 110n) / 100n;

// Pull live fee-market data instead of hardcoding a value, so the script
// adapts automatically as Redbelly Testnet's base fee rises and falls.
const { maxFeePerGas, maxPriorityFeePerGas } =
  await publicClient.estimateFeesPerGas();
const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
const baseFee = latestBlock.baseFeePerGas ?? 0n;

const balance = await publicClient.getBalance({
  address: deployer.account.address,
});
const estimatedCost = gasLimit * maxFeePerGas;

console.log(`\n      Base fee (live)      : ${baseFee} wei (${baseFee / 1_000_000_000n} Gwei)`);
console.log(`      maxFeePerGas         : ${maxFeePerGas} wei (${maxFeePerGas / 1_000_000_000n} Gwei)`);
console.log(`      maxPriorityFeePerGas : ${maxPriorityFeePerGas} wei`);
console.log(`      Raw estimated gas    : ${rawEstimatedGas}`);
console.log(`      Gas limit (+10%)     : ${gasLimit}`);
console.log(`      Estimated cost       : ${estimatedCost} wei (~${Number(estimatedCost) / 1e18} RBNT)`);
console.log(`      Deployer balance     : ${balance} wei (~${Number(balance) / 1e18} RBNT)`);

if (balance < estimatedCost) {
  throw new Error(
    `Insufficient balance for deployment.\n` +
    `  Need : ~${estimatedCost} wei (~${Number(estimatedCost) / 1e18} RBNT)\n` +
    `  Have : ${balance} wei (~${Number(balance) / 1e18} RBNT)\n` +
    `  → Top up the deployer wallet with testnet RBNT from the faucet.`,
  );
}

// walletClient.deployContract() sends the creation transaction and returns
// the tx hash; publicClient.waitForTransactionReceipt() provides the address.
const txHash = await deployer.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [TOKEN_NAME, TOKEN_SYMBOL, permissionContractAddress],
  gas: gasLimit,
  maxFeePerGas,
  maxPriorityFeePerGas,
});

console.log(`\n      Tx hash  : ${txHash}`);
console.log("      Waiting for on-chain confirmation...");

// ---------------------------------------------------------------------------
// Step 3: Wait for confirmation and report
// ---------------------------------------------------------------------------
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
const contractAddress = receipt.contractAddress;

if (!contractAddress) {
  throw new Error("Receipt has no contractAddress — deployment may have failed");
}

console.log("\n[3/3] Confirmed.");
console.log("-".repeat(60));
console.log(`Contract address    : ${contractAddress}`);
console.log(`Transaction hash    : ${txHash}`);
console.log(`Block number        : ${receipt.blockNumber}`);
console.log(`Constructor args    :`);
console.log(`  name                = "${TOKEN_NAME}"`);
console.log(`  symbol              = "${TOKEN_SYMBOL}"`);
console.log(`  eligibilityContract = ${permissionContractAddress}`);
console.log("-".repeat(60));

// ---------------------------------------------------------------------------
// Step 4: Write deployments/redbellyTestnet.json
// ---------------------------------------------------------------------------
const deploymentsDir = path.join(__dirname, "..", "deployments");
fs.mkdirSync(deploymentsDir, { recursive: true });

const deploymentRecord = {
  network: "redbellyTestnet",
  chainId: 153,
  contractName: "SybilProofToken",
  address: contractAddress,
  txHash,
  blockNumber: receipt.blockNumber.toString(),
  abiPath: "artifacts/contracts/SybilProofToken.sol/SybilProofToken.json",
  constructorArgs: {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    eligibilityContract: permissionContractAddress,
  },
  deployedAt: new Date().toISOString(),
};

const outPath = path.join(deploymentsDir, "redbellyTestnet.json");
fs.writeFileSync(outPath, JSON.stringify(deploymentRecord, null, 2));

console.log(`\nDeployment record written to: deployments/redbellyTestnet.json`);
