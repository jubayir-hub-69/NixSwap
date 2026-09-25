import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@cofhe/hardhat-plugin";
import * as dotenv from "dotenv";

dotenv.config();

// CoFHE testnets read a single deployer key. Leave it unset for local compile/test.
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      // Required by @fhenixprotocol/cofhe-contracts (transient storage opcodes).
      evmVersion: "cancun",
    },
  },
  networks: {
    "Ethereum Sepolia": {
      url:
        process.env.SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia.publicnode.com",
      accounts,
      chainId: 11155111,
    },
    "Arbitrum Sepolia": {
      url:
        process.env.ARBITRUM_SEPOLIA_RPC_URL ??
        "https://sepolia-rollup.arbitrum.io/rpc",
      accounts,
      chainId: 421614,
    },
    "Base Sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      accounts,
      chainId: 84532,
    },
  },
};

export default config;
