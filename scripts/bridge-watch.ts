import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroHash,
  zeroPadValue,
  type EventLog,
  type Log,
  type Signer,
} from "ethers";
import { confirmsFor, delay, detail } from "./solver-core.js";
import { LAYERZERO_CHAINS, LAYERZERO_TESTNET_ENDPOINT, layerZeroChain } from "./layerzero.js";

const BRIDGE_ABI = [
  "event BridgeSent(bytes32 indexed guid, uint32 indexed dstEid, bytes32 indexed tokenId, uint64 nonce, address sender, address recipient, uint256 amount, uint8 decimals)",
  "function executed(bytes32 guid) view returns (bool)",
  "function localEid() view returns (uint32)",
  "function peers(uint32 eid) view returns (bytes32)",
];

const ENDPOINT_ABI = [
  "function inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 nonce) view returns (bytes32)",
  "function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes calldata message, bytes extraData) payable",
];

type BridgeTarget = {
  name: string;
  chainId: number;
  signer: Signer;
  confirms: number;
};

const idle = new Set<number>();
const noted = new Set<string>();
const cursors = new Map<string, number>();
const providers = new Map<number, JsonRpcProvider>();
const coder = AbiCoder.defaultAbiCoder();

type PendingDelivery = {
  srcEid: number;
  sender: string;
  nonce: bigint;
  guid: string;
  tokenId: string;
  recipient: string;
  amount: bigint;
  decimals: bigint | number;
};

// Kept until the destination executes the message. The log cursor must not be the only retry window:
// a release can sit verified until someone deposits escrow.
const pending = new Map<string, PendingDelivery>();

function savedBridges() {
  const jsonPath = path.join(process.cwd(), "frontend", "config", "deployments.json");
  const bridges = new Map<number, string>();
  if (!existsSync(jsonPath)) return bridges;
  const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, { NixBridge?: string }>;
  for (const [key, record] of Object.entries(parsed)) {
    if (typeof record.NixBridge === "string" && /^0x[0-9a-fA-F]{40}$/.test(record.NixBridge)) {
      bridges.set(Number(key), record.NixBridge);
    }
  }
  return bridges;
}

function lookbackBlocks() {
  const raw = Number(process.env.BRIDGE_LOOKBACK_BLOCKS ?? 20_000);
  if (!Number.isInteger(raw) || raw < 100) {
    throw new Error("BRIDGE_LOOKBACK_BLOCKS must be an integer of at least 100.");
  }
  return raw;
}

function providerFor(chainId: number) {
  const cached = providers.get(chainId);
  if (cached) return cached;
  const chain = layerZeroChain(chainId);
  const url = process.env[chain.rpcEnv]?.trim() || chain.rpcDefault;
  const provider = new JsonRpcProvider(url, chain.chainId, { staticNetwork: true });
  providers.set(chainId, provider);
  return provider;
}

export async function retryInboundBridges(target: BridgeTarget) {
  const bridges = savedBridges();
  const localAddress = bridges.get(target.chainId);
  if (!localAddress) {
    if (!idle.has(target.chainId)) {
      idle.add(target.chainId);
      console.log(`[${target.name}] No NixBridge is deployed on this chain. Bridge retry is idle.`);
    }
    return;
  }

  const local = new Contract(localAddress, BRIDGE_ABI, target.signer);
  const localEid = Number(await local.localEid());
  const expected = layerZeroChain(target.chainId);
  if (localEid !== expected.eid) {
    throw new Error(`NixBridge on ${target.name} reports endpoint id ${localEid}, expected ${expected.eid}.`);
  }

  const endpoint = new Contract(LAYERZERO_TESTNET_ENDPOINT, ENDPOINT_ABI, target.signer);
  const latestCache = new Map<number, number>();

  for (const source of LAYERZERO_CHAINS) {
    if (source.chainId === target.chainId) continue;
    const sourceAddress = bridges.get(source.chainId);
    if (!sourceAddress) continue;

    const peer = String(await local.peers(source.eid));
    const expectedPeer = zeroPadValue(sourceAddress, 32);
    if (peer.toLowerCase() !== expectedPeer.toLowerCase()) {
      const key = `peer:${target.chainId}:${source.chainId}`;
      if (!noted.has(key)) {
        noted.add(key);
        console.log(`[${target.name}] Bridge peer for ${source.name} is not the deployed NixBridge. Retries from that chain are off.`);
      }
      continue;
    }

    const sourceProvider = providerFor(source.chainId);
    const sourceBridge = new Contract(sourceAddress, BRIDGE_ABI, sourceProvider);
    const latest = latestCache.get(source.chainId) ?? (await sourceProvider.getBlockNumber());
    latestCache.set(source.chainId, latest);
    const cursorKey = `${source.chainId}->${target.chainId}`;
    const from = cursors.get(cursorKey) ?? Math.max(0, latest - lookbackBlocks());
    let resume = from;

    try {
      for (let start = from; start <= latest; start += 2_000) {
        const end = Math.min(start + 1_999, latest);
        const logs = await sourceBridge.queryFilter(sourceBridge.filters.BridgeSent(null, localEid), start, end);
        for (const log of logs) {
          remember(target.chainId, source.eid, expectedPeer, log);
        }
        resume = end + 1;
      }
      cursors.set(cursorKey, Math.max(0, resume - 20));
    } catch (error) {
      cursors.set(cursorKey, resume);
      console.log(`[${target.name}] Could not finish ${source.name} bridge logs at block ${resume}. ${detail(error)}`);
    }
  }

  await drainPending(target, endpoint, local, localAddress);
}

function remember(chainId: number, srcEid: number, sender: string, log: Log | EventLog) {
  if (!("args" in log)) return;
  const args = log.args as {
    guid?: string;
    nonce?: bigint;
    tokenId?: string;
    recipient?: string;
    amount?: bigint;
    decimals?: bigint | number;
  };
  if (!args.guid || args.nonce === undefined || !args.tokenId || !args.recipient || args.amount === undefined || args.decimals === undefined) {
    return;
  }
  pending.set(`${chainId}:${args.guid}`, {
    srcEid,
    sender,
    nonce: args.nonce,
    guid: args.guid,
    tokenId: args.tokenId,
    recipient: args.recipient,
    amount: args.amount,
    decimals: args.decimals,
  });
}

async function drainPending(target: BridgeTarget, endpoint: Contract, local: Contract, localAddress: string) {
  const prefix = `${target.chainId}:`;
  for (const [key, item] of pending) {
    if (!key.startsWith(prefix)) continue;
    if (await local.executed(item.guid)) {
      pending.delete(key);
      noted.delete(item.guid);
      continue;
    }

    const payloadHash = String(await endpoint.inboundPayloadHash(localAddress, item.srcEid, item.sender, item.nonce));
    if (payloadHash === ZeroHash) continue;

    const message = coder.encode(
      ["bytes32", "address", "uint256", "uint8"],
      [item.tokenId, item.recipient, item.amount, item.decimals],
    );
    const origin = [item.srcEid, item.sender, item.nonce];
    try {
      await endpoint.lzReceive.staticCall(origin, localAddress, item.guid, message, "0x");
    } catch (error) {
      if (!noted.has(item.guid)) {
        noted.add(item.guid);
        console.log(`[${target.name}] Verified bridge message ${item.guid} is waiting. ${detail(error)}`);
      }
      continue;
    }

    const tx = await endpoint.lzReceive(origin, localAddress, item.guid, message, "0x");
    const receipt = await tx.wait(target.confirms);
    if (!receipt || receipt.status !== 1) {
      console.log(`[${target.name}] Bridge retry ${tx.hash} did not confirm.`);
      continue;
    }
    pending.delete(key);
    noted.delete(item.guid);
    console.log(`[${target.name}] Retried bridge delivery ${item.guid} in ${receipt.hash}.`);
  }
}

export async function watchUncoveredBridges(covered: ReadonlySet<number>, key: string, pollMs: number) {
  const bridges = savedBridges();
  const jobs = LAYERZERO_CHAINS.filter((chain) => !covered.has(chain.chainId) && bridges.has(chain.chainId)).map(
    (chain) => watchBridgeChain(chain.chainId, chain.name, key, pollMs),
  );
  if (jobs.length === 0) return;
  await Promise.all(jobs);
}

async function watchBridgeChain(chainId: number, name: string, key: string, pollMs: number) {
  const chain = layerZeroChain(chainId);
  const url = process.env[chain.rpcEnv]?.trim() || chain.rpcDefault;
  const provider = new JsonRpcProvider(url, chain.chainId, { staticNetwork: true });
  const signer = new Wallet(key, provider);
  console.log(`[${name}] Bridge retry is watching this chain. Swap polling follows SOLVER_CHAINS.`);
  for (;;) {
    try {
      await retryInboundBridges({ name, chainId, signer, confirms: confirmsFor(chainId) });
    } catch (error) {
      console.log(`[${name}] bridge poll failed. ${detail(error)}`);
    }
    await delay(pollMs);
  }
}
