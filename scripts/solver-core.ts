import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  Contract,
  ZeroAddress,
  formatUnits,
  type Provider,
  type Signer,
} from "ethers";

type ListedPair = { token: string; pair: string };

const SCALE = 10n ** 12n;
const MAX_U64 = (1n << 64n) - 1n;
const DECRYPT_RETRY_MS = 4 * 60 * 1000;

const REGISTRY_ABI = [
  "function intentCount() view returns (uint256)",
  "function getIntent(uint256 intentId) view returns (tuple(address user, uint8 intentType, bytes32 amount, bytes32 targetChain, bytes32 limit, address solver, uint64 expiresAt, bool solverAuthorized, bool active))",
  "function swapRoute(uint256 intentId) view returns (address tokenIn, address tokenOut)",
  "function grantSolverAccess(uint256 intentId)",
  "function fillSwap(tuple(uint256 intentId, address pair, uint64 amount, uint64 limit, uint32 targetChain) order, bytes amountProof, bytes limitProof, bytes chainProof) returns (uint256 amountOut)",
];

const LAUNCHPAD_ABI = [
  "function allTokens() view returns (tuple(address token, address pair, address creator, string name, string symbol, uint256 supply, uint64 createdAt, bool active)[])",
];

const PAIR_ABI = ["function quoteSwap(address tokenIn, uint256 amountIn) view returns (uint256 amountOut)"];
const SYMBOL_ABI = ["function symbol() view returns (string)"];

type DeploymentRecord = {
  NixToken?: string;
  IntentRegistry?: string;
  NixLaunchpad?: string;
};

type OpenIntent = {
  id: bigint;
  amount: string;
  limit: string;
  targetChain: string;
  solverAuthorized: boolean;
  tokenIn: string;
  tokenOut: string;
};

type Decryptor = {
  decrypt(handle: string): Promise<{ decryptedValue: bigint; signature: string }>;
};

type SentTx = {
  hash: string;
  wait: (confirms?: number) => Promise<{ hash: string; status: number | null } | null>;
};

export type SolverRuntime = {
  name: string;
  chainId: number;
  confirms: number;
  nixAddress: string;
  signer: Signer;
  provider: Provider;
  registry: Contract;
  launchpad: Contract;
  label: string;
  decryptor: Decryptor | null;
};

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

export function confirmsFor(chainId: number) {
  return chainId === 84532 || chainId === 421614 ? 2 : 1;
}

export function pollInterval() {
  const pollMs = Number(process.env.SOLVER_POLL_MS ?? 20_000);
  if (!Number.isFinite(pollMs) || pollMs < 1_000) {
    throw new Error("SOLVER_POLL_MS must be at least 1000.");
  }
  return pollMs;
}

export function loadDeployment(chainId: number) {
  const jsonPath = path.join(process.cwd(), "frontend", "config", "deployments.json");
  if (!existsSync(jsonPath)) throw new Error(`Missing ${jsonPath}.`);
  const deployments = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, DeploymentRecord>;
  const record = deployments[String(chainId)];
  if (!record?.IntentRegistry || !record.NixLaunchpad || !record.NixToken) {
    throw new Error(`No swap deployment is saved for chain ${chainId}.`);
  }
  return {
    NixToken: record.NixToken,
    IntentRegistry: record.IntentRegistry,
    NixLaunchpad: record.NixLaunchpad,
  };
}

export function createRuntime(options: {
  name: string;
  chainId: number;
  signer: Signer;
  provider: Provider;
  label?: string;
}): SolverRuntime {
  const record = loadDeployment(options.chainId);
  return {
    name: options.name,
    chainId: options.chainId,
    confirms: confirmsFor(options.chainId),
    nixAddress: record.NixToken,
    signer: options.signer,
    provider: options.provider,
    registry: new Contract(record.IntentRegistry, REGISTRY_ABI, options.signer),
    launchpad: new Contract(record.NixLaunchpad, LAUNCHPAD_ABI, options.signer),
    label: options.label ?? "",
    decryptor: null,
  };
}

function log(runtime: SolverRuntime, message: string) {
  const prefix = runtime.label ? `[${runtime.label}] ` : "";
  console.log(`${prefix}${message}`);
}

export async function watchIntents(runtime: SolverRuntime, options: { loop: boolean; pollMs: number }) {
  const address = await runtime.signer.getAddress();
  log(runtime, `Solver ${address} on ${runtime.name} (${runtime.chainId}).`);
  log(runtime, `IntentRegistry ${await runtime.registry.getAddress()}`);
  do {
    await settleOpenIntents(runtime);
    if (!options.loop) break;
    await delay(options.pollMs);
  } while (options.loop);
}

export async function settleOpenIntents(runtime: SolverRuntime) {
  const rpc = runtime.provider as Provider & { send(method: string, params: unknown[]): Promise<unknown> };
  const liveHex = String(await rpc.send("eth_chainId", []));
  const liveChainId = Number(BigInt(liveHex));
  if (liveChainId !== runtime.chainId) {
    throw new Error(`RPC returned chain ${liveChainId}, expected ${runtime.chainId}.`);
  }

  const count = (await runtime.registry.intentCount()) as bigint;
  const block = await runtime.provider.getBlock("latest");
  const now = BigInt(block?.timestamp ?? 0);
  const signerAddress = (await runtime.signer.getAddress()).toLowerCase();
  const open: OpenIntent[] = [];
  let otherSolver = 0;

  for (let id = 1n; id <= count; id += 1n) {
    const intent = await runtime.registry.getIntent(id);
    if (!intent.active) continue;
    if (String(intent.solver).toLowerCase() !== signerAddress) {
      otherSolver += 1;
      continue;
    }
    const kind = BigInt(intent.intentType);
    if (kind !== 0n && kind !== 2n) continue;
    if (BigInt(intent.expiresAt) <= now) {
      log(runtime, `Intent ${id} is past its expiry. Leaving it unfilled.`);
      continue;
    }
    const route = await runtime.registry.swapRoute(id);
    if (route[0] === ZeroAddress || route[1] === ZeroAddress) continue;
    open.push({
      id,
      amount: String(intent.amount),
      limit: String(intent.limit),
      targetChain: String(intent.targetChain),
      solverAuthorized: Boolean(intent.solverAuthorized),
      tokenIn: String(route[0]),
      tokenOut: String(route[1]),
    });
  }

  log(runtime, `Scanned ${count} intent(s). ${open.length} open for this solver.`);
  if (otherSolver > 0) {
    log(runtime, `${otherSolver} active intent(s) name a different solver.`);
  }
  if (open.length === 0) return;

  const client = await solverClient(runtime);
  const listed = await runtime.launchpad.allTokens();
  const listings = (listed as ListedPair[]).map((row) => ({ token: row.token, pair: row.pair }));

  for (const intent of open) {
    try {
      await fillOne(runtime, listings, client, intent);
    } catch (error) {
      log(runtime, `Intent ${intent.id} was not filled. ${detail(error)}`);
    }
  }
}

async function fillOne(
  runtime: SolverRuntime,
  listings: readonly ListedPair[],
  client: Decryptor,
  intent: OpenIntent,
) {
  const launched = routedToken(runtime.nixAddress, intent.tokenIn, intent.tokenOut);
  const listing = launched
    ? listings.find((row) => row.token.toLowerCase() === launched.toLowerCase())
    : undefined;
  if (!listing) {
    log(runtime, `Intent ${intent.id} has no pair on the current launchpad. Leaving it open.`);
    return;
  }

  if (!intent.solverAuthorized) {
    log(runtime, `Intent ${intent.id}: granting decrypt access.`);
    await waitFor(runtime.registry.grantSolverAccess(intent.id) as Promise<SentTx>, runtime.confirms);
  }

  const amount = await client.decrypt(intent.amount);
  const limit = await client.decrypt(intent.limit);
  const targetChain = await client.decrypt(intent.targetChain);
  if (amount.decryptedValue > MAX_U64 || limit.decryptedValue > MAX_U64 || targetChain.decryptedValue > 0xffffffffn) {
    log(runtime, `Intent ${intent.id} decrypted outside the public integer range. Leaving it open.`);
    return;
  }
  if (targetChain.decryptedValue !== BigInt(runtime.chainId)) {
    log(runtime, `Intent ${intent.id} targets chain ${targetChain.decryptedValue}. Leaving it open.`);
    return;
  }

  const amountIn = amount.decryptedValue * SCALE;
  const minOut = limit.decryptedValue * SCALE;
  if (amountIn === 0n || minOut === 0n) {
    log(runtime, `Intent ${intent.id} has an empty amount or minimum. Leaving it open.`);
    return;
  }

  const pair = new Contract(listing.pair, PAIR_ABI, runtime.signer);
  let expected: bigint;
  try {
    expected = (await pair.quoteSwap(intent.tokenIn, amountIn)) as bigint;
  } catch (error) {
    log(runtime, `Intent ${intent.id} has no pool quote. ${detail(error)}`);
    return;
  }
  const pay = await symbolOf(runtime, intent.tokenIn);
  const receive = await symbolOf(runtime, intent.tokenOut);
  if (expected < minOut) {
    log(
      runtime,
      `Intent ${intent.id}: selling ${formatUnits(amountIn, 18)} ${pay} pays ${formatUnits(expected, 18)} ${receive}. Minimum is ${formatUnits(minOut, 18)}. Leaving it open.`,
    );
    return;
  }

  const receipt = await waitFor(
    runtime.registry.fillSwap(
      {
        intentId: intent.id,
        pair: listing.pair,
        amount: amount.decryptedValue,
        limit: limit.decryptedValue,
        targetChain: targetChain.decryptedValue,
      },
      amount.signature,
      limit.signature,
      targetChain.signature,
    ) as Promise<SentTx>,
    runtime.confirms,
  );
  log(
    runtime,
    `Filled intent ${intent.id}: ${formatUnits(amountIn, 18)} ${pay} for ${formatUnits(expected, 18)} ${receive}. tx ${receipt.hash}`,
  );
}

function routedToken(nixAddress: string, tokenIn: string, tokenOut: string) {
  const base = nixAddress.toLowerCase();
  if (tokenIn.toLowerCase() === base) return tokenOut;
  if (tokenOut.toLowerCase() === base) return tokenIn;
  return undefined;
}

async function symbolOf(runtime: SolverRuntime, token: string) {
  try {
    const erc20 = new Contract(token, SYMBOL_ABI, runtime.provider);
    return (await erc20.symbol()) as string;
  } catch {
    return token;
  }
}

async function waitFor(pending: Promise<SentTx>, confirms: number) {
  const tx = await pending;
  const receipt = await tx.wait(confirms);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction ${tx.hash} did not confirm.`);
  }
  return receipt;
}

async function solverClient(runtime: SolverRuntime) {
  if (runtime.decryptor) return runtime.decryptor;
  const [{ createCofheConfig, createCofheClient }, adapters, chains] = await Promise.all([
    import("@cofhe/sdk/node"),
    import("@cofhe/sdk/adapters"),
    import("@cofhe/sdk/chains"),
  ]);
  const supported = { 421614: chains.arbSepolia, 84532: chains.baseSepolia, 11155111: chains.sepolia }[runtime.chainId];
  if (!supported) throw new Error(`No CoFHE chain config for ${runtime.chainId}.`);

  const client = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [supported] }));
  const signerWithKey = runtime.signer as Signer & { privateKey?: string };
  const linked =
    typeof signerWithKey.privateKey === "string"
      ? await adapters.Ethers6Adapter(runtime.provider, signerWithKey)
      : await adapters.HardhatSignerAdapter(signerWithKey as never);
  await client.connect(
    linked.publicClient as Parameters<typeof client.connect>[0],
    linked.walletClient as Parameters<typeof client.connect>[1],
  );
  const acp = await client.acp.getOrCreateSelfACP();
  runtime.decryptor = {
    decrypt: (handle: string) =>
      client.decryptForTx(handle).set404RetryTimeout(DECRYPT_RETRY_MS).withACP(acp).execute(),
  };
  log(runtime, "CoFHE solver client connected.");
  return runtime.decryptor;
}
