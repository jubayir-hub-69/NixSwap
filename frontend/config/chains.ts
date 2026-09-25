import { type Chain } from "viem";
import { arbitrumSepolia, baseSepolia, sepolia } from "wagmi/chains";

const ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const ETHEREUM_SEPOLIA_RPC = "https://ethereum-sepolia.publicnode.com";

function chainWithRpc(chain: Chain, rpcUrl: string, name = chain.name): Chain {
  return {
    ...chain,
    name,
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  };
}

/** Same networks and RPCs as `hardhat.config.ts`. */
export const arbitrumSepoliaChain = chainWithRpc(
  arbitrumSepolia,
  ARBITRUM_SEPOLIA_RPC,
);
export const baseSepoliaChain = chainWithRpc(baseSepolia, BASE_SEPOLIA_RPC);
export const ethereumSepoliaChain = chainWithRpc(
  sepolia,
  ETHEREUM_SEPOLIA_RPC,
  "Ethereum Sepolia",
);

export const chains = [
  arbitrumSepoliaChain,
  baseSepoliaChain,
  ethereumSepoliaChain,
] as const;

export const transports = {
  [arbitrumSepoliaChain.id]: ARBITRUM_SEPOLIA_RPC,
  [baseSepoliaChain.id]: BASE_SEPOLIA_RPC,
  [ethereumSepoliaChain.id]: ETHEREUM_SEPOLIA_RPC,
} as const;
