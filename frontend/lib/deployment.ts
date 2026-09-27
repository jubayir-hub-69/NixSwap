import { deployments } from "@/config/contracts";

export type DeployedChainId = keyof typeof deployments;

export function deploymentFor(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  const key = String(chainId) as DeployedChainId;
  return key in deployments ? deployments[key] : undefined;
}

export const deployedChains = Object.values(deployments);

export function optionalAddress(record: object | undefined, key: string): `0x${string}` | undefined {
  if (!record || !(key in record)) return undefined;
  const value = (record as Record<string, unknown>)[key];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined;
  if (/^0x0+$/i.test(value)) return undefined;
  return value as `0x${string}`;
}

const explorers: Record<number, string> = {
  421614: "https://sepolia.arbiscan.io",
  84532: "https://sepolia.basescan.org",
  11155111: "https://sepolia.etherscan.io",
};

export function transactionUrl(chainId: number | undefined, hash: string) {
  if (chainId === undefined) return undefined;
  const base = explorers[chainId];
  return base ? `${base}/tx/${hash}` : undefined;
}
