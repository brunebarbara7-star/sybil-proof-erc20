# SybilProof Token — Frontend Example

A Next.js reference UI for [`SybilProofToken`](../contracts-and-tests/contracts/SybilProofToken.sol) — an ERC-20 that gates minting (and optionally transfers) behind Redbelly Network's on-chain KYC verification. This app embeds Redbelly's `IndividualOnboarding` widget, shows real-time verification status via `useHasChainPermission`, and lets a verified wallet mint and transfer SPT on **Redbelly Testnet (chain ID 153)**.

For contract architecture, deployment steps, and troubleshooting, see [`../docs/integration-guide.md`](../docs/integration-guide.md). This file covers running the app and **using it as an end user**.

---

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`NEXT_PUBLIC_AVERER_API_KEY` in `.env.local` can stay empty during development — the app runs fine; only the KYC widget's backend calls (session creation/status checks) need a real key once Redbelly/Averer issues one. See the integration guide §4.1 for details.

---

## User Guide — How to Use the App

### 1. Add Redbelly Testnet to your wallet

You need a browser wallet (MetaMask or similar) configured with:

| Field            | Value                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| Network name     | Redbelly Testnet                                                                     |
| Chain ID         | `153`                                                                                |
| RPC URL          | `https://governors.testnet.redbelly.network/` (override via `NEXT_PUBLIC_REDBELLY_TESTNET_RPC_URL`) |
| Currency symbol  | RBNT                                                                                 |
| Block explorer   | `https://redbelly.testnet.routescan.io`                                             |

### 2. Enable your wallet for network-level write access

Separate from this token's own KYC gate, Redbelly requires every wallet to complete a one-time network-level access check before its RPC nodes accept *any* transaction. Do this once at **`https://access.redbelly.network/`**. Skipping it produces a `Sender not authorised to write transactions` error — that's the network rejecting you, not this app or the contract.

### 3. Get testnet RBNT

Fund your wallet via Redbelly's faucet (web faucet, or `/faucet <address>` in the `testnet-faucet` Discord channel). You need RBNT to pay gas for minting and transferring.

### 4. Connect your wallet

Click **Connect Wallet** in the Identity panel (top-left on desktop, top of the page on mobile). Approve the connection in your wallet — your truncated address then appears with a **Disconnect** link beside it.

If your wallet is on a different chain, a red banner appears:

> ⚠ Your wallet is connected to the wrong network. Switch to Redbelly Testnet to continue.

Click **Switch Network** to request the chain switch directly from the app — no manual network entry needed if your wallet already has chain 153 saved.

### 5. Check your KYC status

The **KYC Status** badge polls automatically (every ~3 seconds):

- **✅ Verified** — this wallet already has on-chain permission (possibly granted via a different app, since the status is network-wide, not specific to this site).
- **❌ Not Verified — complete KYC below** — it doesn't yet.

### 6. Complete KYC (if unverified)

The **IndividualOnboarding** widget is embedded directly below the status badge — there's no separate site to visit. Follow its identity-verification steps to completion. Once Redbelly's backend grants on-chain permission, the badge above flips to ✅ Verified on its own (no page refresh needed).

### 7. Mint SPT

In the Token Actions panel:

1. Enter an amount in the **Mint** field.
2. Click **Mint** and confirm the transaction in your wallet.
3. Watch the status line step through *"Confirm in wallet…" → "Waiting for confirmation…" → "✅ Confirmed"*. Your balance refreshes automatically once confirmed.

The Mint button is disabled — with the specific reason shown right below the input — whenever: the wallet isn't connected, it's on the wrong network, or KYC isn't complete yet.

### 8. Transfer SPT

1. Enter a recipient address and an amount in the **Transfer** form.
2. Click **Transfer** and confirm in your wallet.

Transfers are only KYC-gated if the contract owner has turned on `transferGateEnabled`. By default it's off, so any connected wallet on the right network can transfer regardless of KYC status — the disabled-state messaging reflects whichever mode is currently active on-chain.

### 9. Reading errors

If a transaction reverts, the actual on-chain reason is decoded and shown in plain language — e.g. *"Reverted: wallet 0x1234… is not KYC verified."* — instead of a generic "transaction reverted" message.

---

## Project Structure

```
app/
  layout.tsx      Root layout — wraps the app in Providers
  providers.tsx   WagmiProvider + QueryClientProvider + EligibilitySDKProvider
  page.tsx        The full UI described above
lib/
  wagmi.ts        Redbelly Testnet chain definition + wagmi config (injected/MetaMask connector)
  contract.ts     Deployed SybilProofToken address + ABI
  abi/SybilProofToken.json
```
