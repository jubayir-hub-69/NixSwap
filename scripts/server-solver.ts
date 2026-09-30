import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { JsonRpcProvider, Wallet } from "ethers";
import { retryInboundBridges, watchUncoveredBridges } from "./bridge-watch.js";
import { settleOmnichain } from "./launch-relay.js";
import {
  createRuntime,
  delay,
  detail,
  pollInterval,
  settleOpenIntents,
  type SolverRuntime,
} from "./solver-core.js";

type SolverNetwork = {
  name: string;
  chainId: number;
  rpcEnv: string;
  rpcDefault: string;
  aliases: readonly string[];
};

const NETWORKS: readonly SolverNetwork[] = [
  {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia-rollup.arbitrum.io/rpc",
    aliases: ["421614", "arbitrum sepolia", "arbitrum-sepolia", "arbitrum", "arb"],
  },
  {
    name: "Base Sepolia",
    chainId: 84532,
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia.base.org",
    aliases: ["84532", "base sepolia", "base-sepolia", "base"],
  },
  {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcEnv: "SEPOLIA_RPC_URL",
    rpcDefault: "https://ethereum-sepolia.publicnode.com",
    aliases: ["11155111", "ethereum sepolia", "ethereum-sepolia", "sepolia", "ethereum"],
  },
];

const DEFAULT_NETWORKS = [NETWORKS[0], NETWORKS[1]];

export function createSolverServer() {
  return http.createServer((req, res) => {
    const requestPath = (req.url ?? "/").split("?")[0] || "/";
    if (req.method === "GET" && requestPath === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Solver Active");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });
}

export function selectNetworks(raw: string | undefined) {
  const source = raw?.trim();
  if (!source) return [...DEFAULT_NETWORKS];
  if (source.toLowerCase() === "all") return [...NETWORKS];

  const tokens = source
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [...DEFAULT_NETWORKS];

  const selected: SolverNetwork[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    const network = NETWORKS.find((candidate) => candidate.aliases.includes(token.toLowerCase()));
    if (!network) {
      throw new Error(
        `Unknown SOLVER_CHAINS entry "${token}". Use chain ids or names such as 421614, 84532, "Arbitrum Sepolia", "Base Sepolia", or all.`,
      );
    }
    if (seen.has(network.chainId)) continue;
    seen.add(network.chainId);
    selected.push(network);
  }
  return selected;
}

function listenPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === "") return 10000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a TCP port. Received ${raw}.`);
  }
  return port;
}

function signingKey() {
  const raw = process.env.PRIVATE_KEY?.trim();
  if (!raw) throw new Error("PRIVATE_KEY is required.");
  const key = raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("PRIVATE_KEY must be a 32-byte hex string.");
  }
  return key;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === __filename;
}

async function watchNetwork(network: SolverNetwork, key: string, pollMs: number) {
  const url = process.env[network.rpcEnv]?.trim() || network.rpcDefault;
  const provider = new JsonRpcProvider(url, network.chainId, { staticNetwork: true });
  let runtime: SolverRuntime;
  try {
    runtime = createRuntime({
      name: network.name,
      chainId: network.chainId,
      signer: new Wallet(key, provider),
      provider,
      label: network.name,
    });
  } catch (error) {
    console.error(`[${network.name}] ${detail(error)}`);
    return;
  }

  const address = await runtime.signer.getAddress();
  console.log(`[${network.name}] Solver ${address} on ${network.name} (${network.chainId}).`);
  console.log(`[${network.name}] IntentRegistry ${await runtime.registry.getAddress()}`);
  console.log(`[${network.name}] Polling every ${pollMs}ms.`);

  for (;;) {
    try {
      await settleOpenIntents(runtime);
    } catch (error) {
      console.log(`[${network.name}] poll failed. ${detail(error)}`);
    }
    try {
      await settleOmnichain(runtime);
    } catch (error) {
      console.log(`[${network.name}] omnichain poll failed. ${detail(error)}`);
    }
    try {
      await retryInboundBridges({
        name: network.name,
        chainId: network.chainId,
        signer: runtime.signer,
        confirms: runtime.confirms,
      });
    } catch (error) {
      console.log(`[${network.name}] bridge poll failed. ${detail(error)}`);
    }
    await delay(pollMs);
  }
}

async function startSolvers() {
  let pollMs: number;
  let networks: SolverNetwork[];
  let key: string;
  try {
    pollMs = pollInterval();
    networks = selectNetworks(process.env.SOLVER_CHAINS);
    key = signingKey();
  } catch (error) {
    console.error(detail(error));
    return;
  }

  const names = networks.map((network) => `${network.name} (${network.chainId})`).join(", ");
  console.log(`Watching ${names}.`);
  await Promise.all([
    ...networks.map((network) => watchNetwork(network, key, pollMs)),
    watchUncoveredBridges(new Set(networks.map((network) => network.chainId)), key, pollMs),
  ]);
}

function main() {
  const port = listenPort();
  const server = createSolverServer();
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Solver HTTP listening on ${port}`);
  });
  void startSolvers();
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(detail(error));
    process.exitCode = 1;
  }
}
