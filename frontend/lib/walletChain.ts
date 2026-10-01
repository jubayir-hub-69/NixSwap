import { numberToHex, type Chain } from "viem";
import { chains } from "@/config/chains";

export type WalletProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

export function isWalletProvider(value: unknown): value is WalletProvider {
  return Boolean(value && typeof value === "object" && "request" in value && typeof (value as WalletProvider).request === "function");
}

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { code?: unknown; cause?: unknown; data?: { originalError?: { code?: unknown } } };
  if (typeof record.code === "number") return record.code;
  const nested = record.data?.originalError?.code;
  if (typeof nested === "number") return nested;
  return errorCode(record.cause);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function missingChain(error: unknown) {
  const code = errorCode(error);
  if (code === 4902) return true;
  return /unrecognized chain|chain not added|not connected to|try adding the chain/i.test(errorMessage(error));
}

function chainParams(chain: Chain) {
  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
  };
}

/** Asks the injected wallet to switch, and adds the chain when the wallet does not know it yet. */
export async function switchWalletChain(provider: WalletProvider, chainId: number) {
  const chain = chains.find((item) => item.id === chainId);
  if (!chain) throw new Error("This network is not a NixSwap chain.");
  const params = [{ chainId: numberToHex(chainId) }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (error) {
    if (!missingChain(error)) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chainParams(chain)] });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
