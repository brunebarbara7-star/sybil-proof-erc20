import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, hardhatVerify],
  verify: {
    etherscan: {
      apiKey: "ANY_STRING_WORKS",
    },
  },
  chainDescriptors: {
    153: {
      name: "Redbelly Testnet",
      blockExplorers: {
        etherscan: {
          name: "Routescan",
          url: "https://redbelly.testnet.routescan.io/",
          apiUrl: "https://api.routescan.io/v2/network/testnet/evm/153/etherscan",
        },
      },
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    redbellyTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("REDBELLY_TESTNET_RPC_URL"),
      chainId: 153,
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
