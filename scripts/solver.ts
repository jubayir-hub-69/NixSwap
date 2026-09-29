import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import hre from "hardhat";
import type { IntentRegistry, NixLaunchpad } from "../typechain-types";

type ListedPair = { token: string; pair: string };

const SCALE = 10n ** 12n;
const MAX_U64 = (1n << 64n) - 1n;
const DECRYPT_RETRY_MS = 4 * 60 * 1000;

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

let cofhe: {
  decrypt(handle: string): Promise<{ decryptedValue: bigint; signature: string }>;
} | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

async function main() {
  const chainId = Number(hre.network.config.chainId);
  if (!Number.isInteger(chainId)) {
    throw new Error(`Network ${hre.network.name} has no chain id.`);
  }
  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No solver account is configured for this network.");

  const jsonPath = path.join(process.cwd(), "frontend", "config", "deployments.json");
  if (!existsSync(jsonPath)) throw new Error(`Missing ${jsonPath}.`);
  const deployments = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, DeploymentRecord>;
  const record = deployments[String(chainId)];
  if (!record?.IntentRegistry || !record.NixLaunchpad || !record.NixToken) {
    throw new Error(`No swap deployment is saved for chain ${chainId}.`);
  }

  const registry = await hre.ethers.getContractAt("IntentRegistry", record.IntentRegistry, signer);
  const launchpad = await hre.ethers.getContractAt("NixLaunchpad", record.NixLaunchpad, signer);
  const confirms = chainId === 84532 || chainId === 421614 ? 2 : 1;
  const loop = process.env.SOLVER_LOOP === "1";
  const pollMs = Number(process.env.SOLVER_POLL_MS ?? 20_000);
  if (!Number.isFinite(pollMs) || pollMs < 1_000) {
    throw new Error("SOLVER_POLL_MS must be at least 1000.");
  }

  console.log(`Solver ${signer.address} on ${hre.network.name} (${chainId}).`);
  console.log(`IntentRegistry ${record.IntentRegistry}`);
  do {
    await settleOpenIntents(registry, launchpad, record.NixToken, signer, confirms);
    if (!loop) break;
    await delay(pollMs);
  } while (loop);
}

async function settleOpenIntents(
  registry: IntentRegistry,
  launchpad: NixLaunchpad,
  nixAddress: string,
  signer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number],
  confirms: number,
) {
  const count = await registry.intentCount();
  const now = BigInt((await hre.ethers.provider.getBlock("latest"))?.timestamp ?? 0);
  const open: OpenIntent[] = [];
  let otherSolver = 0;

  for (let id = 1n; id <= count; id += 1n) {
    const intent = await registry.getIntent(id);
    if (!intent.active) continue;
    if (intent.solver.toLowerCase() !== signer.address.toLowerCase()) {
      otherSolver += 1;
      continue;
    }
    const kind = BigInt(intent.intentType);
    if (kind !== 0n && kind !== 2n) continue;
    if (intent.expiresAt <= now) {
      console.log(`Intent ${id} is past its expiry. Leaving it unfilled.`);
      continue;
    }
    const route = await registry.swapRoute(id);
    if (route[0] === hre.ethers.ZeroAddress || route[1] === hre.ethers.ZeroAddress) continue;
    open.push({
      id,
      amount: String(intent.amount),
      limit: String(intent.limit),
      targetChain: String(intent.targetChain),
      solverAuthorized: intent.solverAuthorized,
      tokenIn: route[0],
      tokenOut: route[1],
    });
  }

  console.log(`Scanned ${count} intent(s). ${open.length} open for this solver.`);
  if (otherSolver > 0) {
    console.log(`${otherSolver} active intent(s) name a different solver.`);
  }
  if (open.length === 0) return;

  const client = await solverClient(signer);
  const listed = await launchpad.allTokens();
  const listings = listed.map((row) => ({ token: row.token, pair: row.pair }));

  for (const intent of open) {
    try {
      await fillOne(registry, listings, nixAddress, client, intent, confirms);
    } catch (error) {
      console.log(`Intent ${intent.id} was not filled. ${detail(error)}`);
    }
  }
}

async function fillOne(
  registry: IntentRegistry,
  listings: readonly ListedPair[],
  nixAddress: string,
  client: NonNullable<typeof cofhe>,
  intent: OpenIntent,
  confirms: number,
) {
  const launched = routedToken(nixAddress, intent.tokenIn, intent.tokenOut);
  const listing = launched
    ? listings.find((row) => row.token.toLowerCase() === launched.toLowerCase())
    : undefined;
  if (!listing) {
    console.log(`Intent ${intent.id} has no pair on the current launchpad. Leaving it open.`);
    return;
  }

  if (!intent.solverAuthorized) {
    console.log(`Intent ${intent.id}: granting decrypt access.`);
    await waitFor(registry.grantSolverAccess(intent.id), confirms);
  }

  const amount = await client.decrypt(intent.amount);
  const limit = await client.decrypt(intent.limit);
  const targetChain = await client.decrypt(intent.targetChain);
  if (amount.decryptedValue > MAX_U64 || limit.decryptedValue > MAX_U64 || targetChain.decryptedValue > 0xffffffffn) {
    console.log(`Intent ${intent.id} decrypted outside the public integer range. Leaving it open.`);
    return;
  }
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (targetChain.decryptedValue !== BigInt(chainId)) {
    console.log(`Intent ${intent.id} targets chain ${targetChain.decryptedValue}. Leaving it open.`);
    return;
  }

  const amountIn = amount.decryptedValue * SCALE;
  const minOut = limit.decryptedValue * SCALE;
  if (amountIn === 0n || minOut === 0n) {
    console.log(`Intent ${intent.id} has an empty amount or minimum. Leaving it open.`);
    return;
  }

  const pair = await hre.ethers.getContractAt("NixPair", listing.pair);
  let expected: bigint;
  try {
    expected = await pair.quoteSwap(intent.tokenIn, amountIn);
  } catch (error) {
    console.log(`Intent ${intent.id} has no pool quote. ${detail(error)}`);
    return;
  }
  const pay = await symbolOf(intent.tokenIn);
  const receive = await symbolOf(intent.tokenOut);
  if (expected < minOut) {
    console.log(
      `Intent ${intent.id}: selling ${hre.ethers.formatUnits(amountIn, 18)} ${pay} pays ${hre.ethers.formatUnits(expected, 18)} ${receive}. Minimum is ${hre.ethers.formatUnits(minOut, 18)}. Leaving it open.`,
    );
    return;
  }

  const receipt = await waitFor(
    registry.fillSwap(
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
    ),
    confirms,
  );
  console.log(
    `Filled intent ${intent.id}: ${hre.ethers.formatUnits(amountIn, 18)} ${pay} for ${hre.ethers.formatUnits(expected, 18)} ${receive}. tx ${receipt.hash}`,
  );
}

function routedToken(nixAddress: string, tokenIn: string, tokenOut: string) {
  const base = nixAddress.toLowerCase();
  if (tokenIn.toLowerCase() === base) return tokenOut;
  if (tokenOut.toLowerCase() === base) return tokenIn;
  return undefined;
}

async function symbolOf(token: string) {
  try {
    const erc20 = await hre.ethers.getContractAt(["function symbol() view returns (string)"], token);
    return await erc20.symbol();
  } catch {
    return token;
  }
}

async function waitFor(
  pending: Promise<{ wait: (confirms?: number) => Promise<{ hash: string; status: number | null } | null>; hash: string }>,
  confirms: number,
) {
  const tx = await pending;
  const receipt = await tx.wait(confirms);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction ${tx.hash} did not confirm.`);
  }
  return receipt;
}

async function solverClient(signer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number]) {
  if (cofhe) return cofhe;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const [{ createCofheConfig, createCofheClient }, { HardhatSignerAdapter }, chains] = await Promise.all([
    import("@cofhe/sdk/node"),
    import("@cofhe/sdk/adapters"),
    import("@cofhe/sdk/chains"),
  ]);
  const supported = { 421614: chains.arbSepolia, 84532: chains.baseSepolia, 11155111: chains.sepolia }[chainId];
  if (!supported) throw new Error(`No CoFHE chain config for ${chainId}.`);

  const client = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [supported] }));
  const { publicClient, walletClient } = await HardhatSignerAdapter(signer);
  await client.connect(publicClient, walletClient);
  const acp = await client.acp.getOrCreateSelfACP();
  cofhe = {
    decrypt: (handle: string) =>
      client.decryptForTx(handle).set404RetryTimeout(DECRYPT_RETRY_MS).withACP(acp).execute(),
  };
  console.log("CoFHE solver client connected.");
  return cofhe;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
