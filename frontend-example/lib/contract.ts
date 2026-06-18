import type { Abi } from "viem";
import tokenAbi from "./abi/SybilProofToken.json";

// Deployed on Redbelly Testnet (chain ID 153).
// See ../../contracts-and-tests/deployments/redbellyTestnet.json for the deployment record.
export const TOKEN_ADDRESS =
  "0x7e489f46098bcdfbe3df9a171cc7a82a75768b08" as const;

export const TOKEN_ABI = tokenAbi as Abi;
