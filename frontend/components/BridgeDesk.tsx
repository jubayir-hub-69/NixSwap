"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { OftBridge } from "@/components/OftBridge";
import { RouteCard } from "@/components/RouteCard";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { bridgeAddress, bridgeChain, bridgeChains, configOf, limitOf, parseWalletAddress, peerMatches } from "@/lib/bridge";
import { deploymentFor, errorText, liveReadQuery, optionalAddress, preferredChainId } from "@/lib/deployment";
import { isWalletProvider, switchWalletChain } from "@/lib/walletChain";

const fieldClass = "mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost";
const buttonClass = "btn-primary min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold";

export function BridgeDesk() {
  const { address, chainId: walletChainId, connector, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [chainPrompt, setChainPrompt] = useState(false);
  const bridgeTx = useChainTx();
  const liquidityTx = useChainTx();
  const source = bridgeChain(walletChainId);
  const bridge = bridgeAddress(source?.chainId);
  const [destId, setDestId] = useState<number>(84532);
  const [tokenChoice, setTokenChoice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [liquidity, setLiquidity] = useState("");

  const choices = bridgeChains.filter((chain) => chain.chainId !== source?.chainId);
  const destination = choices.find((chain) => chain.chainId === destId) ?? choices[0];
  const destBridge = bridgeAddress(destination?.chainId);

  const tokenCount = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "tokenCount",
    chainId: source?.chainId,
    query: { enabled: Boolean(bridge && source), ...liveReadQuery },
  });
  const count = typeof tokenCount.data === "bigint" ? Number(tokenCount.data) : 0;
  const listedCount = count > 32 ? 0 : count;

  const idQuery = useReadContracts({
    contracts: Array.from({ length: listedCount }, (_, index) => ({
      address: bridge,
      abi: abis.NixBridge,
      functionName: "tokenIdAt" as const,
      args: [BigInt(index)] as const,
      chainId: source?.chainId,
    })),
    query: { enabled: Boolean(bridge && source && listedCount > 0), ...liveReadQuery },
  });
  const tokenIds = useMemo(() => {
    const ids: `0x${string}`[] = [];
    for (const row of idQuery.data ?? []) {
      if (row.status === "success" && typeof row.result === "string" && /^0x[0-9a-fA-F]{64}$/.test(row.result)) {
        ids.push(row.result as `0x${string}`);
      }
    }
    return ids;
  }, [idQuery.data]);

  const configQuery = useReadContracts({
    contracts: tokenIds.map((tokenId) => ({
      address: bridge,
      abi: abis.NixBridge,
      functionName: "tokenConfig" as const,
      args: [tokenId] as const,
      chainId: source?.chainId,
    })),
    query: { enabled: Boolean(bridge && source && tokenIds.length > 0), ...liveReadQuery },
  });
  const configs = useMemo(() => {
    return tokenIds.flatMap((tokenId, index) => {
      const config = configOf(configQuery.data?.[index]?.result);
      return config ? [{ id: tokenId, ...config }] : [];
    });
  }, [tokenIds, configQuery.data]);

  const symbolQuery = useReadContracts({
    contracts: configs.map((config) => ({
      address: config.token,
      abi: erc20Abi,
      functionName: "symbol" as const,
      chainId: source?.chainId,
    })),
    query: { enabled: configs.length > 0, staleTime: 60_000 },
  });
  const listed = useMemo(() => {
    return configs.map((config, index) => {
      const row = symbolQuery.data?.[index];
      const read = row?.status === "success" && typeof row.result === "string" ? row.result.trim() : "";
      const symbol = read || `${config.token.slice(0, 6)}…${config.token.slice(-4)}`;
      return { ...config, symbol };
    });
  }, [configs, symbolQuery.data]);

  const selected = listed.find((token) => token.id === tokenChoice) ?? listed[0];
  const parsed = selected ? parseUnits(amount, selected.decimals) : null;
  const liquidityParsed = selected ? parseUnits(liquidity, selected.decimals) : null;
  const recipient = recipientInput.trim() === "" ? (address ?? null) : parseWalletAddress(recipientInput);
  const recipientInvalid = recipientInput.trim() !== "" && recipient === null;

  const balance = useErc20Balance(selected?.token, address, source?.chainId);
  const native = useBalance({
    address,
    chainId: source?.chainId,
    query: { enabled: Boolean(address && source), ...liveReadQuery },
  });
  const peer = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "peers",
    args: destination ? [destination.eid] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(bridge && source && destination), ...liveReadQuery },
  });
  const destConfigQuery = useReadContract({
    address: destBridge,
    abi: abis.NixBridge,
    functionName: "tokenConfig",
    args: selected ? [selected.id] : undefined,
    chainId: destination?.chainId,
    query: { enabled: Boolean(destBridge && destination && selected), ...liveReadQuery },
  });
  const escrow = useReadContract({
    address: destBridge,
    abi: abis.NixBridge,
    functionName: "accounted",
    args: selected ? [selected.id] : undefined,
    chainId: destination?.chainId,
    query: { enabled: Boolean(destBridge && destination && selected), ...liveReadQuery },
  });
  const localEscrow = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "accounted",
    args: selected ? [selected.id] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(bridge && source && selected), ...liveReadQuery },
  });
  const limitQuery = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "rateLimit",
    args: selected && destination ? [selected.id, destination.eid, false] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(bridge && source && selected && destination), ...liveReadQuery },
  });
  const allowance = useReadContract({
    address: selected?.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && bridge ? [address, bridge] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(selected && address && bridge && source), ...liveReadQuery },
  });

  const destConfig = configOf(destConfigQuery.data);
  const limit = limitOf(limitQuery.data);
  const peerOk = peerMatches(peer.data, destBridge);
  const tokensLoading = Boolean(
    bridge &&
      (tokenCount.isLoading ||
        count > 32 ||
        (listedCount > 0 && (idQuery.isLoading || configQuery.isLoading || symbolQuery.isLoading))),
  );
  const quoteEnabled = Boolean(
    bridge &&
      source &&
      destination &&
      selected?.enabled &&
      destBridge &&
      destConfig &&
      destConfig.decimals === selected.decimals &&
      peerOk &&
      recipient &&
      parsed &&
      parsed > 0n &&
      limit &&
      limit.capacity > 0n &&
      parsed <= limit.available &&
      typeof escrow.data === "bigint" &&
      escrow.data >= parsed,
  );
  const quote = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "quoteSend",
    args: destination && selected && parsed && recipient ? [destination.eid, selected.id, parsed, recipient] : undefined,
    chainId: source?.chainId,
    query: { enabled: quoteEnabled, ...liveReadQuery },
  });
  const fee = quoteEnabled && typeof quote.data === "bigint" ? quote.data : undefined;
  const feeValue = fee === undefined ? undefined : (fee * 11n) / 10n;
  const allowanceValue = typeof allowance.data === "bigint" ? allowance.data : undefined;
  const nativeValue = native.data?.value;

  let blocker: string | null = null;
  let escrowShort = false;
  let action: "connect" | "switch" | "approve" | "bridge" | null = null;
  if (!isConnected) action = "connect";
  else if (!source) {
    action = "switch";
    blocker = "Switch to Arbitrum Sepolia, Base Sepolia, or Ethereum Sepolia.";
  } else if (!bridge) blocker = `The bridge contract is not deployed on ${source.name} yet.`;
  else if (tokenCount.isError) blocker = "Could not read the bridge token list.";
  else if (count > 32) blocker = "This bridge lists more tokens than the page can read.";
  else if (tokensLoading) blocker = "Reading registered tokens…";
  else if (!selected || !destination) blocker = "No token is registered on this bridge yet.";
  else if (!selected.enabled) blocker = `${selected.symbol} is disabled on ${source.name}.`;
  else if (!destBridge) blocker = `The bridge contract is not deployed on ${destination.name} yet.`;
  else if (recipientInvalid) blocker = "Enter a valid recipient address. The zero address cannot receive tokens.";
  else if (!recipient) blocker = "Enter the address that should receive the tokens.";
  else if (amount.trim() === "") blocker = "Enter an amount.";
  else if (parsed === null) blocker = `Use at most ${selected.decimals} decimal places.`;
  else if (parsed === 0n) blocker = "Enter an amount greater than zero.";
  else if (balance.loading) blocker = "Reading your balance…";
  else if (balance.error || balance.value === undefined) blocker = "Could not read your token balance on this network.";
  else if (parsed > balance.value) {
    blocker = `This wallet holds ${formatUnits(balance.value, selected.decimals)} ${selected.symbol}, which is less than ${formatUnits(parsed, selected.decimals)} ${selected.symbol}.`;
  } else if (peer.isLoading) blocker = "Reading the route…";
  else if (peer.isError) blocker = "Could not read the route peer.";
  else if (!peerOk) {
    blocker =
      peer.data === "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? `The route from ${source.name} to ${destination.name} is not wired yet.`
        : "This route's on-chain peer does not match the deployed bridge. Bridging is disabled.";
  } else if (destConfigQuery.isLoading) blocker = "Reading the destination token…";
  else if (destConfigQuery.isError) blocker = `Could not read the token registration on ${destination.name}.`;
  else if (!destConfig) blocker = `${selected.symbol} is not registered on ${destination.name}.`;
  else if (destConfig.decimals !== selected.decimals) {
    blocker = `${selected.symbol} uses ${selected.decimals} decimals on ${source.name} and ${destConfig.decimals} on ${destination.name}.`;
  } else if (escrow.isLoading) blocker = "Reading destination liquidity…";
  else if (escrow.isError || typeof escrow.data !== "bigint") blocker = `Could not read escrow on ${destination.name}.`;
  else if (escrow.data < parsed) {
    escrowShort = true;
    blocker = `${destination.name} escrow holds ${formatUnits(escrow.data, selected.decimals)} ${selected.symbol}.`;
  } else if (limitQuery.isLoading) blocker = "Reading the rate limit…";
  else if (limitQuery.isError || !limit) blocker = "Could not read the rate limit.";
  else if (limit.capacity === 0n) blocker = "A rate limit is not set for this route.";
  else if (parsed > limit.available) {
    blocker = `This amount is above the current rate limit of ${formatUnits(limit.available, selected.decimals)} ${selected.symbol}.`;
  } else if (allowance.isLoading || allowanceValue === undefined) blocker = "Reading token approval…";
  else if (allowanceValue < parsed) action = "approve";
  else if (quote.isLoading || (quote.isFetching && fee === undefined)) blocker = "Reading the bridge fee…";
  else if (quote.isError) blocker = errorText(quote.error);
  else if (fee === undefined || fee === 0n || feeValue === undefined) blocker = "The bridge fee quote was not available.";
  else if (native.isLoading || nativeValue === undefined) blocker = "Reading the ETH balance for the bridge fee…";
  else if (native.isError) blocker = "Could not read the ETH balance for the bridge fee.";
  else if (nativeValue < feeValue) {
    blocker = `The LayerZero fee is ${formatUnits(fee, 18, 8)} ETH. This wallet has ${formatUnits(nativeValue, 18, 8)} ETH.`;
  } else action = "bridge";

  const busy = bridgeTx.pending || liquidityTx.pending || switching || chainPrompt;
  const nixAddress = optionalAddress(deploymentFor(source?.chainId), "NixToken");
  const nixRoute = Boolean(selected && nixAddress && selected.token.toLowerCase() === nixAddress.toLowerCase());
  const buttonLabel =
    action === "connect"
      ? "Connect wallet"
      : action === "switch"
        ? "Switch network"
        : action === "approve"
          ? `Approve ${selected?.symbol ?? "token"}`
          : action === "bridge"
            ? "Bridge"
            : "Bridge";

  async function promptSwitch(nextChainId: number) {
    setSwitchError(null);
    setChainPrompt(true);
    try {
      const provider = await connector?.getProvider();
      if (!isWalletProvider(provider)) {
        switchChain({ chainId: nextChainId });
        return;
      }
      await switchWalletChain(provider, nextChainId);
    } catch (error) {
      setSwitchError(errorText(error));
    } finally {
      setChainPrompt(false);
    }
  }

  async function depositOnDestination() {
    if (!destination || !selected || !parsed || typeof escrow.data !== "bigint") return;
    const shortfall = parsed > escrow.data ? parsed - escrow.data : parsed;
    setLiquidity(plainUnits(shortfall, selected.decimals));
    await promptSwitch(destination.chainId);
  }

  async function approve(amountToApprove: bigint) {
    if (!selected || !bridge || !source) return;
    await bridgeTx.submit(() =>
      bridgeTx.writeContractAsync({
        address: selected.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [bridge, amountToApprove],
        chainId: source.chainId,
      }),
    );
    await allowance.refetch();
  }

  async function bridgeTokens() {
    if (!selected || !bridge || !source || !destination || !recipient || !parsed || feeValue === undefined) return;
    await bridgeTx.submit(() =>
      bridgeTx.writeContractAsync({
        address: bridge,
        abi: abis.NixBridge,
        functionName: "send",
        args: [destination.eid, selected.id, parsed, recipient],
        value: feeValue,
        chainId: source.chainId,
      }),
    );
    await Promise.all([balance.refetch(), escrow.refetch(), localEscrow.refetch()]);
  }

  async function approveLiquidity() {
    if (!selected || !bridge || !source || !liquidityParsed) return;
    await liquidityTx.submit(() =>
      liquidityTx.writeContractAsync({
        address: selected.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [bridge, liquidityParsed],
        chainId: source.chainId,
      }),
    );
    await allowance.refetch();
  }

  async function depositLiquidity() {
    if (!selected || !bridge || !source || !liquidityParsed) return;
    await liquidityTx.submit(() =>
      liquidityTx.writeContractAsync({
        address: bridge,
        abi: abis.NixBridge,
        functionName: "deposit",
        args: [selected.id, liquidityParsed],
        chainId: source.chainId,
      }),
    );
    setLiquidity("");
    await Promise.all([balance.refetch(), localEscrow.refetch()]);
  }

  const liquidityReady = Boolean(
    selected &&
      source &&
      bridge &&
      liquidityParsed &&
      liquidityParsed > 0n &&
      balance.value !== undefined &&
      liquidityParsed <= balance.value &&
      allowanceValue !== undefined,
  );
  const liquidityNeedsApproval = Boolean(liquidityReady && allowanceValue !== undefined && liquidityParsed && allowanceValue < liquidityParsed);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Bridge</h1>
        <p className="mt-1 text-xs leading-5 text-mist">
          Registered tokens, including NIX, lock on this network. LayerZero releases the same amount from escrow on
          the destination. That path never mints. A launched token that reports an omnichain endpoint id burns here
          and mints on the destination. A token is listed only when this chain returns its address.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-mist">
            From
            <select
              data-testid="bridge-source"
              className={fieldClass}
              value={source?.chainId ?? ""}
              disabled={!isConnected || busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (bridgeChain(next)) void promptSwitch(next);
              }}
            >
              {source ? null : <option value="">Select a network</option>}
              {bridgeChains.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-mist">
            To
            <select
              data-testid="bridge-destination"
              className={fieldClass}
              value={destination?.chainId ?? ""}
              disabled={!destination || busy}
              onChange={(event) => setDestId(Number(event.target.value))}
            >
              {choices.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="glass-panel rounded-[28px] p-5">
        <h2 className="text-sm font-semibold text-frost">Lock and release</h2>
        <p className="mt-1 text-xs leading-5 text-mist">
          This form approves NixBridge, then locks the token. Use it for NIX and other tokens the bridge has registered.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (action === "connect") openConnectModal?.();
            else if (action === "switch") void promptSwitch(preferredChainId);
            else if (action === "approve" && parsed) void approve(parsed);
            else if (action === "bridge") void bridgeTokens();
          }}
        >
          <label className="block text-xs text-mist">
            Token
            <select
              data-testid="bridge-token"
              className={fieldClass}
              value={selected?.id ?? ""}
              disabled={!selected || busy}
              onChange={(event) => setTokenChoice(event.target.value)}
            >
              {listed.length === 0 ? <option value="">No registered token</option> : null}
              {listed.map((token) => (
                <option key={token.id} value={token.id}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
              <span>Amount</span>
              <span>
                {formatBalance(Boolean(address && selected), balance.loading, balance.error, balance.value, selected?.decimals ?? 18)}
                {selected ? ` ${selected.symbol}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <input
                data-testid="bridge-amount"
                value={amount}
                inputMode="decimal"
                placeholder="0"
                aria-label="Bridge amount"
                onChange={(event) => {
                  const next = decimalInput(event.target.value);
                  if (next !== null) setAmount(next);
                }}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
              <button
                type="button"
                className="text-xs text-cyan-glow disabled:opacity-40"
                disabled={balance.value === undefined || !selected || busy}
                onClick={() => {
                  if (balance.value !== undefined && selected) setAmount(plainUnits(balance.value, selected.decimals));
                }}
              >
                Max
              </button>
            </span>
          </label>
          <label className="block text-xs text-mist">
            Recipient
            <input
              data-testid="bridge-recipient"
              value={recipientInput}
              placeholder={address ?? "0x"}
              aria-label="Recipient address"
              aria-invalid={recipientInvalid}
              onChange={(event) => setRecipientInput(event.target.value)}
              className={fieldClass}
            />
          </label>
          <p className="text-xs text-mist">
            {recipientInput.trim() === ""
              ? "Leave this blank to receive the tokens at your connected address."
              : "The destination payment goes to this address. It cannot be changed after you sign."}
          </p>
          <div className="space-y-2 text-sm" data-testid="bridge-status">
            <div className="flex justify-between gap-3">
              <span className="text-mist">Destination escrow</span>
              <span className="text-right text-frost" data-testid="bridge-escrow">
                {!selected || !destination
                  ? "—"
                  : escrow.isLoading
                    ? "Reading…"
                    : typeof escrow.data === "bigint"
                      ? `${formatUnits(escrow.data, selected.decimals)} ${selected.symbol}`
                      : "Unavailable"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-mist">Rate limit left</span>
              <span className="text-right text-frost">
                {!selected
                  ? "—"
                  : limitQuery.isLoading
                    ? "Reading…"
                    : limit
                      ? `${formatUnits(limit.available, selected.decimals)} ${selected.symbol}`
                      : "Unavailable"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-mist">LayerZero fee</span>
              <span className="text-right text-frost" data-testid="bridge-fee">
                {fee === undefined ? (quoteEnabled && quote.isLoading ? "Reading…" : "—") : `${formatUnits(fee, 18, 8)} ETH`}
              </span>
            </div>
          </div>
          <RouteCard
            testId="bridge-route"
            mode="Lock and release"
            from={source?.name}
            to={destination?.name}
            fromChainId={source?.chainId}
            token={selected?.symbol}
            amount={parsed ? formatUnits(parsed, selected?.decimals ?? 18) : undefined}
            quotedFee={fee !== undefined ? `${formatUnits(fee, 18, 8)} ETH` : undefined}
            walletFee={feeValue !== undefined ? `${formatUnits(feeValue, 18, 8)} ETH` : undefined}
          />
          <p className="min-h-5 text-xs leading-5 text-rose-300" data-testid="bridge-error">
            {escrowShort || action === "connect" || action === "bridge" || action === "approve" ? "" : blocker}
          </p>
          {escrowShort && selected && destination && typeof escrow.data === "bigint" ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-mist" data-testid="bridge-escrow-guide">
              <p className="text-frost">
                {destination.name} escrow holds {formatUnits(escrow.data, selected.decimals)} {selected.symbol}.
              </p>
              <p className="mt-2">
                Lock and release pays this transfer from tokens already sitting in the {destination.name} bridge. It does not mint {selected.symbol}. Deposit {selected.symbol} on {destination.name} first. Switching fills the deposit field with the amount the escrow is missing.
              </p>
              {nixRoute ? (
                <p className="mt-2">
                  The cloud solver also deposits NIX into a destination escrow that is below its target, when the solver wallet on {destination.name} holds NIX. Your own deposit is available as soon as it confirms. The solver deposit waits for its next poll.
                </p>
              ) : null}
              <button
                type="button"
                className="mt-3 text-sm text-cyan-glow disabled:opacity-40"
                disabled={busy}
                data-testid="bridge-deposit-switch"
                onClick={() => void depositOnDestination()}
              >
                Switch to {destination.name} to deposit
              </button>
            </div>
          ) : null}
          {switchError ? <p className="text-xs leading-5 text-rose-300">{switchError}</p> : null}
          <button
            type="submit"
            data-testid="bridge-submit"
            className={buttonClass}
            disabled={busy || (isConnected && action === null)}
            aria-busy={bridgeTx.pending}
          >
            <TxButtonContent pending={bridgeTx.pending} phase={bridgeTx.phase} idle={buttonLabel} />
          </button>
          <TxNotice phase={bridgeTx.phase} error={bridgeTx.error} hash={bridgeTx.hash} chainId={source?.chainId} />
        </form>
      </section>

      <section className="glass-panel rounded-[28px] p-5">
        <h2 className="text-sm font-semibold text-frost">Escrow on this chain</h2>
        <p className="mt-1 text-xs leading-5 text-mist">
          A deposit funds releases into {source?.name ?? "this network"}. Deposited tokens leave only when a verified
          LayerZero message pays a recipient.
        </p>
        <p className="mt-3 text-sm text-frost" data-testid="bridge-local-escrow">
          {!selected
            ? "No registered token."
            : localEscrow.isLoading
              ? "Reading…"
              : typeof localEscrow.data === "bigint"
                ? `${formatUnits(localEscrow.data, selected.decimals)} ${selected.symbol}`
                : "Escrow is unavailable."}
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !liquidityReady) return;
            if (!isConnected) openConnectModal?.();
            else if (!source) void promptSwitch(preferredChainId);
            else if (liquidityNeedsApproval) void approveLiquidity();
            else void depositLiquidity();
          }}
        >
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 block text-xs text-mist">Deposit amount</span>
            <input
              data-testid="bridge-deposit-amount"
              value={liquidity}
              inputMode="decimal"
              placeholder="0"
              aria-label="Deposit amount"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setLiquidity(next);
              }}
              className="w-full bg-transparent text-2xl text-frost outline-none placeholder:text-white/20"
            />
          </label>
          <button
            type="submit"
            data-testid="bridge-deposit"
            className={buttonClass}
            disabled={busy || (isConnected && !liquidityReady)}
            aria-busy={liquidityTx.pending}
          >
            <TxButtonContent
              pending={liquidityTx.pending}
              phase={liquidityTx.phase}
              idle={!isConnected ? "Connect wallet" : liquidityNeedsApproval ? `Approve ${selected?.symbol ?? "token"}` : "Deposit"}
            />
          </button>
          {selected && liquidityParsed && balance.value !== undefined && liquidityParsed > balance.value ? (
            <p className="text-xs text-rose-300">
              This wallet holds {formatUnits(balance.value, selected.decimals)} {selected.symbol}, which is less than the deposit.
            </p>
          ) : null}
          <TxNotice phase={liquidityTx.phase} error={liquidityTx.error} hash={liquidityTx.hash} chainId={source?.chainId} />
        </form>
      </section>
      <OftBridge />
    </main>
  );
}
