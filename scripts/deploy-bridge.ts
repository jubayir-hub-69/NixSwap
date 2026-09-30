import path from "node:path";
import { Contract, ZeroAddress, ZeroHash, getAddress, zeroPadValue } from "ethers";
import hre from "hardhat";
import { loadDeployments, writeFrontendConfig } from "./frontend-config";
import {
  LAYERZERO_CHAINS,
  LAYERZERO_TESTNET_ENDPOINT,
  NIX_BRIDGE_CAPACITY,
  NIX_BRIDGE_REFILL_PER_SECOND,
  layerZeroChain,
} from "./layerzero";

const L2_CHAIN_IDS = new Set([84532, 421614]);
const ENDPOINT_ABI = [
  "function eid() view returns (uint32)",
  "function delegates(address oapp) view returns (address)",
];

let nonce = 0;
let confirmations = 1;
let deployer!: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

type TxLike = {
  hash: string;
  wait: (confirms: number) => Promise<{ status: number | null; hash: string } | null>;
};

async function main() {
  const networkName = hre.network.name;
  if (networkName === "hardhat" || networkName === "localhost") {
    throw new Error("Run this against Ethereum Sepolia, Arbitrum Sepolia, or Base Sepolia.");
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Set PRIVATE_KEY in .env before deploying the bridge.");
  }

  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No deployer account is configured for this network.");
  deployer = signer;

  const chainId = Number(hre.network.config.chainId);
  const local = layerZeroChain(chainId);
  confirmations = L2_CHAIN_IDS.has(chainId) ? 2 : 1;
  nonce = await settledNonce(deployer.address);
  console.log(`Bridge deploy from ${deployer.address} at nonce ${nonce} on ${local.name}.`);

  const endpoint = new Contract(LAYERZERO_TESTNET_ENDPOINT, ENDPOINT_ABI, deployer);
  const code = await hre.ethers.provider.getCode(LAYERZERO_TESTNET_ENDPOINT);
  if (!code || code === "0x") {
    throw new Error(`LayerZero Endpoint V2 has no code at ${LAYERZERO_TESTNET_ENDPOINT} on ${local.name}.`);
  }
  const onchainEid = Number(await endpoint.eid());
  if (onchainEid !== local.eid) {
    throw new Error(`Endpoint eid() is ${onchainEid} on ${local.name}. Expected ${local.eid}.`);
  }

  const jsonPath = path.join(process.cwd(), "frontend", "config", "deployments.json");
  const deployments = loadDeployments(jsonPath);
  const existing = deployments[String(chainId)];
  if (!existing?.NixToken) {
    throw new Error(`No NixToken is saved for ${local.name}. Deploy the token before the bridge.`);
  }
  const nixToken = getAddress(existing.NixToken);
  const nixCode = await hre.ethers.provider.getCode(nixToken);
  if (!nixCode || nixCode === "0x") {
    throw new Error(`NixToken ${nixToken} has no code on ${local.name}.`);
  }

  const bridge = await loadOrDeploy(existing.NixBridge, local.eid);
  const bridgeAddress = getAddress(await bridge.getAddress());
  const owner = getAddress(await bridge.owner());
  if (owner !== getAddress(deployer.address)) {
    throw new Error(`NixBridge owner is ${owner}. This key cannot configure it.`);
  }
  const delegate = getAddress(await endpoint.delegates(bridgeAddress));
  if (delegate !== owner) {
    throw new Error(`Endpoint delegate for ${bridgeAddress} is ${delegate}. Expected the owner.`);
  }

  const nixId = (await bridge.NIX_TOKEN_ID()) as string;
  const config = await bridge.tokenConfig(nixId);
  if (config.token === ZeroAddress) {
    await send(bridge.registerToken(nixId, nixToken, await overrides()));
    console.log(`Registered NIX ${nixToken} as ${nixId}.`);
  } else if (getAddress(config.token) !== nixToken) {
    throw new Error(`NIX_TOKEN_ID on ${bridgeAddress} points at ${config.token}, not ${nixToken}.`);
  } else {
    console.log(`NIX is already registered on ${bridgeAddress}.`);
  }

  for (const remote of LAYERZERO_CHAINS) {
    if (remote.chainId === chainId) continue;
    const outbound = await bridge.rateLimit(nixId, remote.eid, false);
    const inbound = await bridge.rateLimit(nixId, remote.eid, true);
    if (outbound.capacity === 0n) {
      await send(bridge.setRateLimit(nixId, remote.eid, false, NIX_BRIDGE_CAPACITY, NIX_BRIDGE_REFILL_PER_SECOND, await overrides()));
      console.log(`Outbound NIX limit toward ${remote.name}: ${NIX_BRIDGE_CAPACITY} wei, refill ${NIX_BRIDGE_REFILL_PER_SECOND} wei/s.`);
    }
    if (inbound.capacity === 0n) {
      await send(bridge.setRateLimit(nixId, remote.eid, true, NIX_BRIDGE_CAPACITY, NIX_BRIDGE_REFILL_PER_SECOND, await overrides()));
      console.log(`Inbound NIX limit from ${remote.name}: ${NIX_BRIDGE_CAPACITY} wei, refill ${NIX_BRIDGE_REFILL_PER_SECOND} wei/s.`);
    }

    const remoteBridge = deployments[String(remote.chainId)]?.NixBridge;
    if (!remoteBridge) {
      console.log(`No NixBridge is saved for ${remote.name}. Peer stays unset until that deploy is recorded.`);
      continue;
    }
    const expected = zeroPadValue(getAddress(remoteBridge), 32);
    const current = String(await bridge.peers(remote.eid));
    if (current === ZeroHash) {
      await send(bridge.setPeer(remote.eid, expected, await overrides()));
      console.log(`Peer for ${remote.name} set to ${getAddress(remoteBridge)}.`);
    } else if (current.toLowerCase() !== expected.toLowerCase()) {
      console.log(
        `Peer for ${remote.name} is ${current}. The saved bridge is ${expected}. Leaving it. queuePeer starts the 1 day timelock.`,
      );
    } else {
      console.log(`Peer for ${remote.name} already matches ${getAddress(remoteBridge)}.`);
    }
  }

  existing.NixBridge = bridgeAddress;
  existing.network = networkName;
  existing.deployer = deployer.address;
  await writeFrontendConfig({ [String(chainId)]: existing });
  console.log(`NixBridge on ${local.name}: ${bridgeAddress}`);
  console.log("Escrow starts at zero. Deposit NIX on each destination before a release can succeed.");
}

async function loadOrDeploy(saved: string | undefined, eid: number) {
  if (saved && hre.ethers.isAddress(saved)) {
    const address = getAddress(saved);
    const code = await hre.ethers.provider.getCode(address);
    if (code && code !== "0x") {
      const bridge = await hre.ethers.getContractAt("NixBridge", address, deployer);
      const liveEid = Number(await bridge.localEid());
      const liveEndpoint = getAddress(await bridge.endpoint());
      if (liveEid !== eid || liveEndpoint !== getAddress(LAYERZERO_TESTNET_ENDPOINT)) {
        throw new Error(`Saved NixBridge ${address} points at endpoint ${liveEndpoint} eid ${liveEid}.`);
      }
      console.log(`Using saved NixBridge ${address}.`);
      return bridge;
    }
  }

  const factory = await hre.ethers.getContractFactory("NixBridge", deployer);
  const txOverrides = await overrides();
  const unsigned = await factory.getDeployTransaction(LAYERZERO_TESTNET_ENDPOINT, eid, deployer.address);
  try {
    const estimated = await deployer.estimateGas({ ...unsigned, nonce: txOverrides.nonce });
    txOverrides.gasLimit = (estimated * 130n) / 100n + 100_000n;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`NixBridge deployment estimate failed. ${detail}`);
  }
  const deployed = await factory.deploy(LAYERZERO_TESTNET_ENDPOINT, eid, deployer.address, txOverrides);
  const sent = deployed.deploymentTransaction();
  if (!sent) throw new Error("NixBridge did not produce a deployment transaction.");
  const receipt = await sent.wait(confirmations);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
    throw new Error(`NixBridge deployment ${sent.hash} was not confirmed.`);
  }
  const code = await hre.ethers.provider.getCode(receipt.contractAddress, receipt.blockNumber);
  if (!code || code === "0x") {
    throw new Error(`NixBridge has no code at ${receipt.contractAddress}.`);
  }
  console.log(`NixBridge deployed at ${receipt.contractAddress} (tx ${sent.hash}).`);
  return hre.ethers.getContractAt("NixBridge", receipt.contractAddress, deployer);
}

async function send(pending: Promise<TxLike>) {
  const tx = await pending;
  const receipt = await tx.wait(confirmations);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction ${tx.hash} did not confirm.`);
  }
  return receipt;
}

async function settledNonce(account: string) {
  const provider = hre.ethers.provider;
  let latest = await provider.getTransactionCount(account, "latest");
  let pending = await provider.getTransactionCount(account, "pending");
  const started = Date.now();
  while (pending > latest && Date.now() - started < 90_000) {
    console.log(`Waiting for in-flight transactions (latest nonce ${latest}, pending nonce ${pending}).`);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    latest = await provider.getTransactionCount(account, "latest");
    pending = await provider.getTransactionCount(account, "pending");
  }
  if (pending !== latest) {
    throw new Error(`Deployer ${account} still has in-flight transactions.`);
  }
  return latest;
}

async function overrides() {
  const fee = await hre.ethers.provider.getFeeData();
  const fields: {
    nonce: number;
    gasLimit?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  } = { nonce };
  nonce += 1;
  if (fee.maxPriorityFeePerGas && fee.maxPriorityFeePerGas > 0n) {
    fields.maxPriorityFeePerGas = fee.maxPriorityFeePerGas * 2n;
  }
  if (fee.maxFeePerGas && fee.maxFeePerGas > 0n) {
    fields.maxFeePerGas = fee.maxFeePerGas * 2n;
  }
  if (
    fields.maxFeePerGas !== undefined &&
    fields.maxPriorityFeePerGas !== undefined &&
    fields.maxPriorityFeePerGas > fields.maxFeePerGas
  ) {
    fields.maxFeePerGas = fields.maxPriorityFeePerGas;
  }
  return fields;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
