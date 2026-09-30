import hre from "hardhat";

export const OMNICHAIN_EIDS = [40231, 40245, 40161] as const;

type SeedToken = {
  getAddress(): Promise<string>;
  approve(spender: string, amount: bigint): Promise<unknown>;
};

/// Deploys three launchpads on one Hardhat chain, each with its own mock endpoint, and wires every peer.
export async function deployOmnichain(nix: SeedToken, owner: string, seeds: bigint) {
  const endpoints = [];
  const pads = [];
  const factories = [];
  for (const eid of OMNICHAIN_EIDS) {
    const endpoint = await hre.ethers.deployContract("MockLayerZeroEndpoint", [eid]);
    const tokenFactory = await hre.ethers.deployContract("LaunchFactory");
    const pad = await hre.ethers.deployContract("NixLaunchpad", [
      await nix.getAddress(),
      await endpoint.getAddress(),
      eid,
      await tokenFactory.getAddress(),
      owner,
    ]);
    await tokenFactory.setLaunchpad(await pad.getAddress());
    endpoints.push(endpoint);
    pads.push(pad);
    factories.push(tokenFactory);
  }

  for (let i = 0; i < pads.length; i++) {
    for (let j = 0; j < pads.length; j++) {
      if (i === j) continue;
      await pads[i].setRemote(
        OMNICHAIN_EIDS[j],
        await pads[j].getAddress(),
        await endpoints[j].getAddress(),
        await factories[j].getAddress(),
      );
    }
  }

  if (seeds > 0n) {
    const unit = await pads[0].SEED_NIX();
    const budget = unit * seeds;
    for (const pad of pads) {
      await nix.approve(await pad.getAddress(), budget);
      await pad.fundSeed(budget);
    }
  }

  return { pads, endpoints, eids: OMNICHAIN_EIDS };
}
