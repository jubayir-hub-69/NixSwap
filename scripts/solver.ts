import hre from "hardhat";
import { createRuntime, pollInterval, watchIntents } from "./solver-core";

async function main() {
  const chainId = Number(hre.network.config.chainId);
  if (!Number.isInteger(chainId)) {
    throw new Error(`Network ${hre.network.name} has no chain id.`);
  }
  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No solver account is configured for this network.");
  const provider = signer.provider;
  if (!provider) throw new Error("Solver signer has no provider.");

  const runtime = createRuntime({
    name: hre.network.name,
    chainId,
    signer,
    provider,
  });
  await watchIntents(runtime, {
    loop: process.env.SOLVER_LOOP === "1",
    pollMs: pollInterval(),
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
