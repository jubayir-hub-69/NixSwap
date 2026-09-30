/** Live LayerZero V2 testnet endpoint. `eid()` was read on each chain before these ids were recorded. */
export const LAYERZERO_TESTNET_ENDPOINT = "0x6EDCE65403992e310A62460808c4b910D972f10f";

export const LAYERZERO_CHAINS = [
  {
    chainId: 11155111,
    eid: 40161,
    name: "Ethereum Sepolia",
    rpcEnv: "SEPOLIA_RPC_URL",
    rpcDefault: "https://ethereum-sepolia.publicnode.com",
  },
  {
    chainId: 421614,
    eid: 40231,
    name: "Arbitrum Sepolia",
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  {
    chainId: 84532,
    eid: 40245,
    name: "Base Sepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia.base.org",
  },
] as const;

export function layerZeroChain(chainId: number) {
  const chain = LAYERZERO_CHAINS.find((item) => item.chainId === chainId);
  if (!chain) {
    throw new Error(`Chain ${chainId} is not one of the NixSwap LayerZero testnets.`);
  }
  return chain;
}

/** Owner-configurable. The deploy script starts each NIX route at 50,000 NIX, refilling over one hour. */
export const NIX_BRIDGE_CAPACITY = 50_000n * 10n ** 18n;
export const NIX_BRIDGE_REFILL_PER_SECOND = NIX_BRIDGE_CAPACITY / 3_600n;
