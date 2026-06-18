"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  parseUnits,
  zeroAddress,
} from "viem";
import {
  IndividualOnboarding,
  useHasChainPermission,
} from "@redbellynetwork/eligibility-sdk";
import { TOKEN_ABI, TOKEN_ADDRESS } from "@/lib/contract";
import { redbellyTestnet } from "@/lib/wagmi";

function truncate(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

// Surfaces the contract's custom revert reason (e.g. NotKYCVerified(address))
// instead of viem's generic "execution reverted" message.
function decodeRevertReason(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof BaseError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const revertError = error.walk(
    (e) => e instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | null;

  if (revertError?.data) {
    const { errorName, args } = revertError.data;
    if (errorName === "NotKYCVerified" && args?.[0]) {
      return `Reverted: wallet ${args[0]} is not KYC verified.`;
    }
    if (errorName) {
      return `Reverted: ${errorName}${args?.length ? `(${args.join(", ")})` : ""}`;
    }
  }

  return error.shortMessage;
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-zinc-400"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function TxStatus({
  isPending,
  isConfirming,
  isSuccess,
  error,
}: {
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: unknown;
}) {
  const revertReason = decodeRevertReason(error);

  if (revertReason) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        ⚠ {revertReason}
      </p>
    );
  }
  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Spinner /> Confirm in wallet…
      </p>
    );
  }
  if (isConfirming) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Spinner /> Waiting for confirmation…
      </p>
    );
  }
  if (isSuccess) {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        ✅ Confirmed
      </p>
    );
  }
  return null;
}

export default function Home() {
  // wagmi's global useChainId() only updates when the wallet's actual chain is
  // one of our configured `chains` — since we only configure Redbelly Testnet,
  // it would silently stay pinned to 153 even on the wrong network. The
  // per-connection chainId from useAccount() always reflects the wallet's
  // real chain, so we use that for the mismatch check instead.
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();

  const {
    switchChain,
    isPending: isSwitchingChain,
    error: switchChainError,
  } = useSwitchChain();
  const isWrongNetwork = isConnected && chainId !== redbellyTestnet.id;

  const { data: isVerified, isLoading: isVerifyLoading } =
    useHasChainPermission(address ?? zeroAddress);

  const { data: decimals } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "decimals",
    chainId: redbellyTestnet.id,
    query: { staleTime: Infinity },
  });
  const tokenDecimals = (decimals as number | undefined) ?? 18;

  const { data: symbol } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "symbol",
    chainId: redbellyTestnet.id,
    query: { staleTime: Infinity },
  });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    chainId: redbellyTestnet.id,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: transferGateEnabled } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "transferGateEnabled",
    chainId: redbellyTestnet.id,
    query: { refetchInterval: 10000 },
  });

  const [mintAmount, setMintAmount] = useState("");
  const [mintFormError, setMintFormError] = useState<string | null>(null);
  const {
    writeContract: writeMint,
    data: mintHash,
    error: mintError,
    isPending: isMintPending,
    reset: resetMint,
  } = useWriteContract();
  const { isLoading: isMintConfirming, isSuccess: isMintSuccess } =
    useWaitForTransactionReceipt({ hash: mintHash });

  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferFormError, setTransferFormError] = useState<string | null>(
    null,
  );
  const {
    writeContract: writeTransfer,
    data: transferHash,
    error: transferError,
    isPending: isTransferPending,
    reset: resetTransfer,
  } = useWriteContract();
  const { isLoading: isTransferConfirming, isSuccess: isTransferSuccess } =
    useWaitForTransactionReceipt({ hash: transferHash });

  useEffect(() => {
    if (isMintSuccess || isTransferSuccess) refetchBalance();
  }, [isMintSuccess, isTransferSuccess, refetchBalance]);

  const formattedBalance =
    balance !== undefined
      ? formatUnits(balance as bigint, tokenDecimals)
      : "—";

  const isMintDisabled =
    !isConnected ||
    isWrongNetwork ||
    isVerifyLoading ||
    isVerified !== true ||
    isMintPending ||
    isMintConfirming;

  const transferRequiresKyc =
    transferGateEnabled === true && isVerified !== true;
  const isTransferDisabled =
    !isConnected ||
    isWrongNetwork ||
    transferRequiresKyc ||
    isTransferPending ||
    isTransferConfirming;

  function handleMint(e: React.FormEvent) {
    e.preventDefault();
    setMintFormError(null);
    resetMint();
    try {
      writeMint({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "mint",
        args: [parseUnits(mintAmount, tokenDecimals)],
        chainId: redbellyTestnet.id,
      });
    } catch {
      setMintFormError("Enter a valid amount.");
    }
  }

  function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferFormError(null);
    resetTransfer();
    try {
      writeTransfer({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [transferTo as `0x${string}`, parseUnits(transferAmount, tokenDecimals)],
        chainId: redbellyTestnet.id,
      });
    } catch {
      setTransferFormError("Enter a valid recipient address and amount.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black lg:h-screen lg:overflow-hidden">
      {/* Slim full-width header — not part of either column */}
      <header className="flex shrink-0 items-center border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            SybilProof Token
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Redbelly Testnet (153) · {truncate(TOKEN_ADDRESS)}
          </p>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2 lg:overflow-hidden">
        {/* Identity panel */}
        <section className="flex flex-col gap-6 border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 lg:overflow-y-auto lg:border-r">
          <div className="flex items-center justify-between gap-4">
            {isConnected && address ? (
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-zinc-200 px-3 py-1 text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                  {truncate(address)}
                </span>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="text-sm font-medium text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => connect({ connector: connectors[0] })}
                disabled={isConnecting || connectors.length === 0}
                className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
          </div>

          {connectors.length === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No injected wallet found — install MetaMask (or another
              browser wallet) to continue.
            </p>
          )}

          {isWrongNetwork && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Your wallet is connected to the wrong network. Switch to
                Redbelly Testnet to continue.
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: redbellyTestnet.id })}
                disabled={isSwitchingChain}
                className="rounded-full bg-red-700 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-600"
              >
                {isSwitchingChain ? "Switching…" : "Switch Network"}
              </button>
              {switchChainError && (
                <p className="w-full text-sm text-red-700 dark:text-red-400">
                  {switchChainError.message}
                </p>
              )}
            </div>
          )}

          {/* KYC status */}
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              KYC Status
            </h2>

            {!isConnected ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Connect your wallet to check verification status.
              </p>
            ) : isVerifyLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <Spinner />
                Checking verification status…
              </div>
            ) : (
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                  isVerified
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                }`}
              >
                {isVerified
                  ? "✅ Verified"
                  : "❌ Not Verified — complete KYC below"}
              </div>
            )}
          </div>

          <IndividualOnboarding />
        </section>

        {/* Token actions panel */}
        <section className="flex flex-col gap-6 bg-white p-6 dark:bg-zinc-950 lg:overflow-y-auto">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Token Balance
            </h2>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              {formattedBalance} {(symbol as string | undefined) ?? "SPT"}
            </p>
          </div>

          {/* Mint */}
          <form onSubmit={handleMint} className="flex flex-col gap-2">
            <label
              htmlFor="mint-amount"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Mint
            </label>
            <div className="flex gap-2">
              <input
                id="mint-amount"
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                disabled={isMintDisabled}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
              />
              <button
                type="submit"
                disabled={isMintDisabled || !mintAmount}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-zinc-50 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
              >
                {isMintPending || isMintConfirming ? "Minting…" : "Mint"}
              </button>
            </div>
            {!isConnected ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Connect your wallet to mint tokens.
              </p>
            ) : isWrongNetwork ? (
              <p className="text-sm text-red-700 dark:text-red-400">
                Switch to Redbelly Testnet above before minting tokens.
              </p>
            ) : !isVerifyLoading && isVerified !== true ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Complete KYC verification above before minting tokens.
              </p>
            ) : null}
            {mintFormError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {mintFormError}
              </p>
            )}
            <TxStatus
              isPending={isMintPending}
              isConfirming={isMintConfirming}
              isSuccess={isMintSuccess}
              error={mintError}
            />
          </form>

          {/* Transfer */}
          <form
            onSubmit={handleTransfer}
            className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          >
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Transfer
            </label>
            <input
              type="text"
              placeholder="Recipient address (0x…)"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              disabled={isTransferDisabled}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
            />
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                disabled={isTransferDisabled}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
              />
              <button
                type="submit"
                disabled={isTransferDisabled || !transferTo || !transferAmount}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-zinc-50 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
              >
                {isTransferPending || isTransferConfirming
                  ? "Sending…"
                  : "Transfer"}
              </button>
            </div>
            {!isConnected ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Connect your wallet to transfer tokens.
              </p>
            ) : isWrongNetwork ? (
              <p className="text-sm text-red-700 dark:text-red-400">
                Switch to Redbelly Testnet above before transferring tokens.
              </p>
            ) : transferRequiresKyc ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Transfers require KYC verification while transfer gating is
                enabled.
              </p>
            ) : null}
            {transferFormError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {transferFormError}
              </p>
            )}
            <TxStatus
              isPending={isTransferPending}
              isConfirming={isTransferConfirming}
              isSuccess={isTransferSuccess}
              error={transferError}
            />
          </form>
        </section>
      </div>
    </div>
  );
}
