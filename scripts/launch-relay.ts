import { AbiCoder, Contract, JsonRpcProvider, ZeroHash, zeroPadValue, type Provider } from "ethers";
import { confirmsFor, detail, loadDeployment, type SolverRuntime } from "./solver-core.js";
import { LAYERZERO_CHAINS, layerZeroChain } from "./layerzero.js";

const OMNICHAIN_ABI = [
  "function chainSlots() view returns (uint256 slots, uint256 bpsPerChain, uint256 creatorBps)",
  "function endpoint() view returns (address)",
  "function localEid() view returns (uint32)",
  "function tokenCount() view returns (uint256)",
  "function tokenInfo(uint256 id) view returns (tuple(address token, address pair, address creator, string name, string symbol, uint256 supply, uint64 createdAt, bool active))",
  "function mirrored(uint256 id) view returns (bool)",
  "function pendingRemoteEids(uint256 id) view returns (uint32[])",
  "function quoteRelay(uint256 id) view returns (uint256)",
  "function relay(uint256 id) payable returns (uint256)",
  "function relays(uint256 id, uint32 eid) view returns (bool sent, bytes32 guid, uint64 nonce, address predicted)",
  "function factory() view returns (address)",
  "function remotes(uint32 eid) view returns (bytes32 peer, address endpoint, address factory, bool set)",
  "function setRemote(uint32 eid, address peer, address remoteEndpoint, address remoteFactory)",
  "function LIQUIDITY_BPS() view returns (uint256)",
  "function remoteOrder(uint32 srcEid, uint256 srcId) view returns (address creator, address sourceToken, address predicted, uint256 supply, uint256 liquidity, bool authorized, bool finalized, string name, string symbol)",
  "function finalizeRemote(uint32 srcEid, uint256 srcId) returns (address token, address pair)",
  "function executed(bytes32 guid) view returns (bool)",
];

const ENDPOINT_ABI = [
  "function inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 nonce) view returns (bytes32)",
  "function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes calldata message, bytes extraData) payable",
];

const coder = AbiCoder.defaultAbiCoder();
const providers = new Map<number, JsonRpcProvider>();
const noted = new Set<string>();

function log(runtime: SolverRuntime, message: string) {
  const prefix = runtime.label ? `[${runtime.label}] ` : "";
  console.log(`${prefix}${message}`);
}

function note(key: string, runtime: SolverRuntime, message: string) {
  if (noted.has(key)) return;
  noted.add(key);
  log(runtime, message);
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

function deployment(chainId: number) {
  try {
    return loadDeployment(chainId);
  } catch {
    return undefined;
  }
}

async function isOmnichain(address: string, provider: Provider) {
  const pad = new Contract(address, OMNICHAIN_ABI, provider);
  try {
    const slots = await pad.chainSlots();
    return { pad, slots: BigInt(slots.slots ?? slots[0]) };
  } catch {
    return undefined;
  }
}

/// Wires missing launchpad peers, relays new launches, and deploys the 2% pool on this chain
/// once the source launchpad's LayerZero message has been authorized.
export async function settleOmnichain(runtime: SolverRuntime) {
  const localAddress = await runtime.launchpad.getAddress();
  const local = await isOmnichain(localAddress, runtime.provider);
  if (!local) return;
  const pad = new Contract(localAddress, OMNICHAIN_ABI, runtime.signer);

  if (local.slots < 3n) {
    await wireMissingPeers(runtime, pad);
  }

  const count = BigInt(await pad.tokenCount());
  for (let id = 0n; id < count; id += 1n) {
    if (await pad.mirrored(id)) continue;
    const pending = (await pad.pendingRemoteEids(id)) as bigint[];
    if (pending.length === 0) continue;
    try {
      const fee = BigInt(await pad.quoteRelay(id));
      if (fee === 0n) continue;
      const value = (fee * 11n) / 10n;
      const balance = await runtime.provider.getBalance(await runtime.signer.getAddress());
      if (balance < value) {
        note(
          `fee:${runtime.chainId}:${id}`,
          runtime,
          `Launch ${id} needs ${value} wei to relay its other pools. The signer holds ${balance} wei.`,
        );
        continue;
      }
      const tx = await pad.relay(id, { value });
      const receipt = await tx.wait(runtime.confirms);
      log(runtime, `Relayed launch ${id} to ${pending.map((eid) => eid.toString()).join(", ")}. ${receipt?.hash ?? tx.hash}`);
    } catch (error) {
      note(`relay:${runtime.chainId}:${id}`, runtime, `Launch ${id} was not relayed. ${detail(error)}`);
    }
  }

  await finalizeInbound(runtime, pad);
  await retryInbound(runtime, pad);
}

async function wireMissingPeers(runtime: SolverRuntime, pad: Contract) {
  let endpoint: string;
  try {
    endpoint = String(await pad.endpoint());
  } catch {
    return;
  }
  for (const remote of LAYERZERO_CHAINS) {
    if (remote.chainId === runtime.chainId) continue;
    const saved = deployment(remote.chainId);
    if (!saved) continue;
    const current = await pad.remotes(remote.eid);
    if (Boolean(current.set ?? current[2])) continue;
    const remoteProvider = providerFor(remote.chainId);
    const remoteReady = await isOmnichain(saved.NixLaunchpad, remoteProvider);
    if (!remoteReady) {
      note(
        `old:${runtime.chainId}:${remote.chainId}`,
        runtime,
        `${remote.name} launchpad is not the omnichain factory, so its peer stays unset.`,
      );
      continue;
    }
    let remoteFactory: string;
    try {
      remoteFactory = String(await remoteReady.pad.factory());
    } catch {
      note(
        `factory:${runtime.chainId}:${remote.chainId}`,
        runtime,
        `${remote.name} launchpad has no token factory, so its peer stays unset.`,
      );
      continue;
    }
    try {
      const tx = await pad.setRemote(remote.eid, saved.NixLaunchpad, endpoint, remoteFactory);
      const receipt = await tx.wait(runtime.confirms);
      log(runtime, `Wired ${remote.name} launchpad ${saved.NixLaunchpad}. ${receipt?.hash ?? tx.hash}`);
    } catch (error) {
      note(`wire:${runtime.chainId}:${remote.chainId}`, runtime, `Could not wire ${remote.name}. ${detail(error)}`);
    }
  }
}

async function finalizeInbound(runtime: SolverRuntime, pad: Contract) {
  const localEid = Number(await pad.localEid());
  for (const source of LAYERZERO_CHAINS) {
    if (source.chainId === runtime.chainId) continue;
    const saved = deployment(source.chainId);
    if (!saved) continue;
    const sourcePad = new Contract(saved.NixLaunchpad, OMNICHAIN_ABI, providerFor(source.chainId));
    let count = 0n;
    try {
      count = BigInt(await sourcePad.tokenCount());
    } catch {
      continue;
    }
    for (let id = 0n; id < count; id += 1n) {
      let relay: { sent?: boolean; 0?: boolean };
      try {
        relay = await sourcePad.relays(id, localEid);
      } catch {
        continue;
      }
      if (!(relay.sent ?? relay[0])) continue;
      const order = await pad.remoteOrder(source.eid, id);
      const authorized = Boolean(order.authorized ?? order[5]);
      const finalized = Boolean(order.finalized ?? order[6]);
      if (!authorized || finalized) continue;
      try {
        const tx = await pad.finalizeRemote(source.eid, id);
        const receipt = await tx.wait(confirmsFor(runtime.chainId));
        log(runtime, `Seeded the ${source.name} launch ${id} on this chain. ${receipt?.hash ?? tx.hash}`);
      } catch (error) {
        note(
          `finalize:${runtime.chainId}:${source.chainId}:${id}`,
          runtime,
          `Launch ${id} from ${source.name} is authorized but the pool was not seeded. ${detail(error)}`,
        );
      }
    }
  }
}

async function retryInbound(runtime: SolverRuntime, pad: Contract) {
  const localAddress = await runtime.launchpad.getAddress();
  const localEid = Number(await pad.localEid());
  const endpointAddress = String(await pad.endpoint());
  const endpoint = new Contract(endpointAddress, ENDPOINT_ABI, runtime.signer);
  const bps = BigInt(await pad.LIQUIDITY_BPS());

  for (const source of LAYERZERO_CHAINS) {
    if (source.chainId === runtime.chainId) continue;
    const saved = deployment(source.chainId);
    if (!saved) continue;
    const sourcePad = new Contract(saved.NixLaunchpad, OMNICHAIN_ABI, providerFor(source.chainId));
    let count = 0n;
    try {
      count = BigInt(await sourcePad.tokenCount());
    } catch {
      continue;
    }
    const sender = zeroPadValue(saved.NixLaunchpad, 32);
    for (let id = 0n; id < count; id += 1n) {
      let relay: { sent?: boolean; guid?: string; nonce?: bigint; predicted?: string; 0?: boolean; 1?: string; 2?: bigint; 3?: string };
      try {
        relay = await sourcePad.relays(id, localEid);
      } catch {
        continue;
      }
      const sent = Boolean(relay.sent ?? relay[0]);
      const guid = String(relay.guid ?? relay[1] ?? "");
      const nonce = relay.nonce ?? relay[2];
      const predicted = String(relay.predicted ?? relay[3] ?? "");
      if (!sent || nonce === undefined || !/^0x[0-9a-fA-F]{64}$/.test(guid)) continue;
      if (await pad.executed(guid)) continue;

      const info = await sourcePad.tokenInfo(id);
      const supply = BigInt(info.supply ?? info[5]);
      const liquidity = (supply * bps) / 10_000n;
      const message = coder.encode(
        ["uint256", "string", "string", "uint256", "uint256", "address", "address", "address"],
        [id, info.name ?? info[3], info.symbol ?? info[4], supply, liquidity, info.token ?? info[0], info.creator ?? info[2], predicted],
      );
      const payloadHash = String(await endpoint.inboundPayloadHash(localAddress, source.eid, sender, nonce));
      if (payloadHash === ZeroHash) continue;
      const origin = [source.eid, sender, nonce];
      try {
        await endpoint.lzReceive.staticCall(origin, localAddress, guid, message, "0x");
        const tx = await endpoint.lzReceive(origin, localAddress, guid, message, "0x");
        const receipt = await tx.wait(runtime.confirms);
        log(runtime, `Retried launch message ${guid} from ${source.name}. ${receipt?.hash ?? tx.hash}`);
      } catch (error) {
        note(`retry:${guid}`, runtime, `Verified launch message ${guid} from ${source.name} is waiting. ${detail(error)}`);
      }
    }
  }
}
