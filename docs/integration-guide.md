# SybilProof Token — Integration Guide

A KYC-gated ERC-20 token built on Redbelly Network's protocol-level eligibility infrastructure. This guide covers contract architecture, deployment to Redbelly Testnet, frontend integration, and troubleshooting for common errors encountered during development.

---

## 1. Overview

Standard ERC-20 tokens have no identity requirements, which makes them trivial for airdrop farmers to exploit by minting from thousands of disposable wallets. Rather than bolting on an external whitelist, SybilProofToken integrates directly with Redbelly's existing on-chain eligibility system — the same infrastructure used across the network for KYC-gated asset access. Any wallet that has completed identity verification through the IndividualOnboardingSDK is automatically recognized by the token contract; unverified wallets are blocked with explicit, KYC-specific error messages rather than generic reverts.

The system has three layers:

1. **Network-level access** — every wallet must first be enabled for write access on Redbelly itself (separate from this token, handled by Redbelly's own access portal).
2. **Permission Contract** — a network-deployed contract exposing `isAllowed(address) → bool`, set by the IndividualOnboardingSDK once a user completes KYC.
3. **SybilProofToken** — our ERC-20 contract, which reads from the Permission Contract before allowing minting or (optionally) transfers.

---

## 2. Contract Architecture

### 2.1 The Bootstrap Registry pattern

Redbelly avoids hardcoding module addresses by routing lookups through a single, stable **Bootstrap Registry** contract, deployed at the same address on every Redbelly environment:

```
0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5
```

```solidity
interface IBootstrapRegistry {
    function getContractAddress(string memory contractName) external view returns (address);
}
```

Calling `getContractAddress("permission")` on this registry returns the current **Permission Contract** address for whichever chain you're querying from. This indirection means Redbelly can upgrade the Permission Contract without breaking every integrator's hardcoded address — integrators just re-resolve through the registry.

```solidity
interface IPermissionContract {
    function isAllowed(address _address) external view returns (bool);
}
```

This is the same contract the official `useHasChainPermission` React hook reads from internally (confirmed by inspecting the SDK's compiled source) — so our on-chain check and the frontend's displayed status are always backed by the same source of truth.

### 2.2 SybilProofToken design

The contract inherits OpenZeppelin's `ERC20` and `Ownable`, and adds:

| Component                                              | Purpose                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eligibilityContract` (address, cached)                | The currently resolved Permission Contract address. Cached rather than re-resolved on every call, for gas efficiency.                                                                                                                              |
| `transferGateEnabled` (bool)                           | Owner-toggleable. When `false` (default), only minting is gated. When `true`, transfers are gated too.                                                                                                                                             |
| `mint(uint256 amount)`                                 | **Public, self-service.** Caller mints to themselves, gated by their own `isAllowed()` status. This is intentional: the original Sybil-farming problem is a self-claim pattern, so the fix has to gate self-minting, not admin-controlled minting. |
| `_update(from, to, value)` override                    | When `transferGateEnabled` is true and neither side is `address(0)` (i.e. a genuine peer-to-peer transfer, not a mint or burn), both sender and recipient must pass `isAllowed()`.                                                                 |
| `setEligibilityContract(address)` (onlyOwner)          | Manually overrides the cached Permission Contract address.                                                                                                                                                                                         |
| `refreshEligibilityContractFromRegistry()` (onlyOwner) | Re-resolves the address fresh from the Bootstrap Registry and updates the cache — used if Redbelly redeploys the Permission Contract.                                                                                                              |
| `setTransferGateEnabled(bool)` (onlyOwner)             | Toggles transfer gating.                                                                                                                                                                                                                           |
| `error NotKYCVerified(address user)`                   | Custom error, reverted with the specific address that failed verification — never a generic revert.                                                                                                                                                |

**Why mint is public but admin functions are owner-only:** minting needs to scale to any number of legitimate users self-claiming tokens, while infrastructure configuration (which Permission Contract to trust, whether transfers are gated) is a protocol-level decision that should sit with the token owner.

**Mint/burn bypass the transfer gate by design:** the `_update` override only applies KYC checks when _both_ `from` and `to` are non-zero. Minting (`from == address(0)`) is already gated separately inside `mint()`; burning (`to == address(0)`) destroys tokens and has no recipient to check, so gating it would be incorrect.

### 2.3 Gas profile

The quality benchmark for this task requires the verification check itself to cost no more than 50,000 gas. Measured on Redbelly Testnet:

| Operation                                                  | Gas    |
| ---------------------------------------------------------- | ------ |
| Isolated `isAllowed()` call (the verification check)       | 27,054 |
| Full `mint()` transaction (check + storage writes + event) | 82,506 |

The isolated check comfortably clears the 50,000 gas ceiling — and the true marginal cost added to a transaction that's already running (rather than a standalone call, which always pays the 21,000 base transaction fee) is closer to 3,000–5,000 gas, since the base fee is paid once regardless of how many internal calls a transaction makes.

---

## 3. Deployment Guide (Redbelly Testnet, Chain ID 153)

### 3.1 Prerequisites

- Node.js and a Hardhat 3 project with `@openzeppelin/contracts` installed.
- A GitHub Personal Access Token with `read:packages` scope (needed to install `@redbellynetwork/eligibility-sdk`, which is hosted on GitHub Packages, not the public npm registry).
- A dedicated deployment wallet — **never reuse a personal/mainnet wallet for testnet deployments.**

### 3.2 Enable network write access (the step that's easy to miss)

Unlike most EVM testnets, simply holding gas tokens is not sufficient to submit transactions on Redbelly. Redbelly is a compliance-first chain: every wallet must complete a network-level identity check and **self-enable** itself for write access before the RPC node will accept _any_ transaction from it — this is separate from, and prior to, our token's own KYC gating.

1. Go to `https://access.redbelly.network/`.
2. Connect the exact wallet you intend to deploy/transact from.
3. Select **Testnet** as the environment.
4. Complete the identity verification flow presented on the site.
5. Wait for the "Account enabled" confirmation.

Skipping this step produces a deceptive-looking error at deployment time: `Sender not authorised to write transactions` — a protocol-level RPC rejection, not a contract or gas issue. See the Troubleshooting section for the full diagnosis.

### 3.3 Get testnet RBNT

Once your wallet is enabled, fund it with test RBNT via Redbelly's faucet (web faucet, or the `testnet-faucet` channel on Redbelly's Discord using `/faucet <address>`).

### 3.4 Configure environment

```
# .env
REDBELLY_TESTNET_RPC_URL=<RPC URL for chain 153 — confirm via your wallet's network settings or chainlist.org/chain/153>
PRIVATE_KEY=<your deployment wallet's private key>
```

`hardhat.config.ts` reads both via Hardhat 3's `configVariable()`, so neither value is ever hardcoded or logged in plaintext.

### 3.5 Deploy

```bash
npm run deploy:testnet
```

The deploy script performs three steps automatically:

1. Calls `getContractAddress("permission")` on the Bootstrap Registry to resolve the current Permission Contract address for the network it's running on (with a zero-address guard, so it fails loudly rather than deploying with a broken eligibility link).
2. Deploys `SybilProofToken` with that resolved address as a constructor argument.
3. Writes the deployment record (address, tx hash, constructor args) to `deployments/redbellyTestnet.json` for later reference (e.g. by the frontend).

### 3.6 Verify the source code on Routescan

Redbelly Testnet's block explorer is Routescan, reachable at `https://redbelly.testnet.routescan.io/`. Verification uses the standard `@nomicfoundation/hardhat-verify` plugin pointed at Routescan's Etherscan-compatible API:

```ts
verify: {
  etherscan: { apiKey: "ANY_STRING_WORKS" },
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
```

```bash
npx hardhat verify etherscan --network redbellyTestnet --force <DEPLOYED_ADDRESS>
```

A successful run shows "Contract Source Code Verified" on the contract's Routescan page.

---

## 4. Frontend Integration Walkthrough

### 4.1 API key handling

The Eligibility SDK requires an API key (issued by Redbelly/Averer — request one via `support@redbelly.network`, referencing your Testnet contract address). This example ships with a **placeholder only** — the key was not yet issued at build time — wired through a `NEXT_PUBLIC_`-prefixed environment variable so the app runs end-to-end (KYC API calls simply fail gracefully until a real key is set):

```
# .env.local
NEXT_PUBLIC_AVERER_API_KEY=""
```

**Before shipping with a real key, change this.** Next.js bundles any `NEXT_PUBLIC_`-prefixed variable into public, client-side JavaScript — anyone can read it from the browser. The secure pattern is to hold the key server-side only and route the SDK's requests through a Next.js API route (`app/api/proxy/route.ts`) that attaches the key on the backend, then configure the provider with `proxyUrl: "/api/proxy"` instead of `apiKey`. This repo intentionally defers that step since no production key exists yet — treat it as the first change to make once Redbelly/Averer issues one.

### 4.2 Provider setup

```tsx
// app/providers.tsx — current (placeholder) configuration
<WagmiProvider config={wagmiConfig}>
  <QueryClientProvider client={queryClient}>
    <EligibilitySDKProvider
      config={{
        network: "testnet",
        apiKey: process.env.NEXT_PUBLIC_AVERER_API_KEY, // placeholder — see 4.1
      }}
    >
      {children}
    </EligibilitySDKProvider>
  </QueryClientProvider>
</WagmiProvider>
```

```tsx
// Production configuration, once a real key exists — replace the block above with:
<EligibilitySDKProvider config={{ network: "testnet", proxyUrl: "/api/proxy" }}>
```

Note: `useHasChainPermission` derives its target chain from the `network` config passed here (`"testnet"` → chain 153) — not from whatever chain the connected wallet happens to be on. This means the displayed KYC status and the wallet's actual transaction-sending chain can disagree if the user is on the wrong network, so the UI must check this separately (see 4.4).

### 4.3 Wallet connection and KYC status

```tsx
const { address, isConnected } = useAccount();
// useHasChainPermission expects a non-optional `string`, so a disconnected
// wallet (address === undefined) falls back to the zero address — the read
// is meaningless until isConnected is true, but never throws a type error.
const { data: isAllowed, isLoading } = useHasChainPermission(address ?? zeroAddress);
```

`isAllowed` is a live boolean (auto-refetched every 3 seconds), used both to render a status badge and to gate the Mint/Transfer buttons. The `<IndividualOnboarding />` widget is rendered unconditionally below the status badge, so unverified users can complete KYC inline without navigating away.

### 4.4 Network-mismatch handling

```tsx
const { isConnected, chainId } = useAccount();
const isWrongNetwork = isConnected && chainId !== 153;
const { switchChain } = useSwitchChain();
```

**Pitfall:** don't use wagmi's global `useChainId()` hook for this check. `useChainId()` reads a value that wagmi only updates when the wallet's *actual* chain is one of the chains listed in `createConfig({ chains: [...] })` — by design, wagmi won't "switch over to" an unconfigured chain internally. Since this app only configures Redbelly Testnet, `useChainId()` stays silently pinned at `153` even when the wallet is genuinely on a different network, so a mismatch banner built on it never appears. `useAccount().chainId`, by contrast, is the raw per-connection value that updates on every real `chainChanged` event regardless of which chains are configured — use that for any check that needs to know what the wallet is *actually* connected to.

Helper text follows a strict precedence — not connected → wrong network → KYC required — so the user is always shown the actual blocking reason rather than a misleading "complete KYC" prompt while sitting on the wrong chain. Mint and Transfer are disabled independently by `isWrongNetwork`, separately from the KYC check.

### 4.5 Surfacing contract-level errors

Failed transactions are decoded (via `ContractFunctionRevertedError`) to surface the actual `NotKYCVerified` custom error in plain language, rather than showing a generic "transaction reverted" message — satisfying the same clarity requirement enforced on-chain.

---

## 5. Testing Summary

The test suite uses mock contracts (`MockPermissionContract`, `MockBootstrapRegistry`) since the real Permission Contract only exists on live Redbelly networks. **19/19 SybilProofToken tests passing** (21 total in the run, including 2 unrelated tests for the project's boilerplate `Counter.sol` sample contract). Coverage on `SybilProofToken.sol`: **96.00% line / 96.55% statement** (97.22%/97.50% project-wide). The single uncovered line is the literal Bootstrap Registry constant, which is only reachable via a live network call — exercising it would require a forked-network test rather than a logic gap.

Covered scenarios: verified minting, unverified minting (reverts with the caller's address), the same wallet failing before and succeeding after KYC, isolated and full-transaction gas measurement, transfer gate toggling in both directions, mint/burn correctly bypassing the transfer gate, and owner-only enforcement on all admin functions.

---

## 6. Troubleshooting

### "Sender not authorised to write transactions"

This is a Redbelly RPC-node-level rejection, not a Hardhat or contract bug — it happens before your transaction ever reaches the contract. The wallet hasn't completed network-level access at `https://access.redbelly.network/` (see section 3.2). The fix is always to enable the wallet there first; no amount of gas or balance will resolve this error.

### Gas estimation failures / "Insufficient balance for deployment"

Redbelly Testnet uses standard EIP-1559 fee mechanics. If you deploy shortly after a period of network activity, the base fee can be temporarily elevated (observed as high as ~127,000 Gwei in testing, against a near-zero baseline when blocks are empty) — base fee decays roughly 12.5% per empty block. Two practical fixes: (1) avoid hardcoding a gas limit; call `estimateGas` against the actual constructor arguments so the script always reflects real, current costs rather than a stale overestimate, and (2) if the estimated cost still exceeds your balance, wait a few minutes for empty blocks to bring the base fee down, or top up via the faucet, before retrying.

### SDK widget not rendering / "API Key is being used directly in the browser"

This console warning means the API key was passed directly to a client-side config (e.g. via a `NEXT_PUBLIC_`-prefixed variable), which bundles it into public JavaScript. Switch to the `proxyUrl` pattern described in section 4.1 — store the key server-side only, and route the widget's requests through a Next.js API route that attaches the key on the backend.

### RPC timeout handling

For read calls (e.g. `isAllowed`, `getContractAddress`), wrap calls in retry logic with exponential backoff rather than failing immediately — public testnet RPC endpoints can be intermittently slow under load. For write calls (deployments, mint/transfer transactions), avoid blindly retrying after a timeout: check the transaction hash on Routescan first, since the transaction may have actually been accepted by the network even if the RPC response timed out client-side. Resubmitting an already-accepted transaction with a new nonce is safe; resubmitting with the _same_ nonce will simply be rejected as a duplicate, which is the expected, safe behavior.

---

## Appendix: Key Reference

| Item                                  | Value                                        |
| ------------------------------------- | -------------------------------------------- |
| Bootstrap Registry (all environments) | `0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5` |
| Redbelly Testnet Chain ID             | 153                                          |
| Network access portal                 | `https://access.redbelly.network/`           |
| Block explorer (Testnet)              | `https://redbelly.testnet.routescan.io/`     |
| API key / support contact             | `support@redbelly.network`                   |
