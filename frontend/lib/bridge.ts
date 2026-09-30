import { getAddress, isAddress, pad, zeroAddress } from "viem";
import { deploymentFor, optionalAddress } from "@/lib/deployment";

/** Live LayerZero V2 testnet endpoint, the same address on Ethereum, Arbitrum, and Base Sepolia. */
export const LAYERZERO_TESTNET_ENDPOINT = "0x6EDCE65403992e310A62460808c4b910D972f10f" as const;

export const bridgeChains = [
  { chainId: 421614, eid: 40231, name: "Arbitrum Sepolia" },
  { chainId: 84532, eid: 40245, name: "Base Sepolia" },
  { chainId: 11155111, eid: 40161, name: "Ethereum Sepolia" },
] as const;

export function bridgeChain(chainId: number | undefined) {
  return bridgeChains.find((chain) => chain.chainId === chainId);
}

export function bridgeAddress(chainId: number | undefined) {
  return optionalAddress(deploymentFor(chainId), "NixBridge");
}

export function parseWalletAddress(value: string) {
  const trimmed = value.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  try {
    const checksum = getAddress(trimmed);
    if (checksum === zeroAddress) return null;
    return checksum;
  } catch {
    return null;
  }
}

export function addressFromPeer(peer: unknown) {
  if (typeof peer !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(peer)) return undefined;
  return parseWalletAddress(`0x${peer.slice(-40)}`);
}

export function peerMatches(peer: unknown, bridge: `0x${string}` | undefined) {
  if (!bridge || typeof peer !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(peer)) return false;
  return peer.toLowerCase() === pad(bridge, { size: 32 }).toLowerCase();
}

export function configOf(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const row = result as {
    token?: string;
    decimals?: number | bigint;
    enabled?: boolean;
    0?: string;
    1?: number | bigint;
    2?: boolean;
  };
  const token = row.token ?? row[0];
  const decimals = row.decimals ?? row[1];
  const enabled = row.enabled ?? row[2];
  if (typeof token !== "string" || !isAddress(token, { strict: false })) return undefined;
  const parsed = typeof decimals === "bigint" ? Number(decimals) : decimals;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || typeof enabled !== "boolean") return undefined;
  if (getAddress(token) === zeroAddress) return undefined;
  return { token: getAddress(token) as `0x${string}`, decimals: parsed, enabled };
}

export function limitOf(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const row = result as {
    capacity?: bigint;
    available?: bigint;
    0?: bigint;
    2?: bigint;
  };
  const capacity = row.capacity ?? row[0];
  const available = row.available ?? row[2];
  if (typeof capacity !== "bigint" || typeof available !== "bigint") return undefined;
  return { capacity, available };
}
