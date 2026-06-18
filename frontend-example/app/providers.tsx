"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EligibilitySDKProvider } from "@redbellynetwork/eligibility-sdk";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <EligibilitySDKProvider
          config={{
            network: "testnet",
            // Placeholder until Averer Customer Support issues a production key.
            apiKey: process.env.NEXT_PUBLIC_AVERER_API_KEY,
          }}
        >
          {children}
        </EligibilitySDKProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
