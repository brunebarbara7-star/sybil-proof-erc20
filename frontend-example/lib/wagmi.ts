import { createConfig, http, injected } from "wagmi";
import { defineChain } from "viem";

export const redbellyTestnet = defineChain({
  id: 153,
  name: "Redbelly Testnet",
  nativeCurrency: { name: "Redbelly Network Token", symbol: "RBNT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_REDBELLY_TESTNET_RPC_URL ||
          "https://governors.testnet.redbelly.network/",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Routescan",
      url: "https://redbelly.testnet.routescan.io",
    },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [redbellyTestnet],
  connectors: [injected()],
  transports: {
    [redbellyTestnet.id]: http(),
  },
  ssr: true,
});
