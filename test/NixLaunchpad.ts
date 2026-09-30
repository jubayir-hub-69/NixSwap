import { expect } from "chai";
import hre from "hardhat";
import { deployOmnichain } from "./omnichainFixture";

describe("NixLaunchpad", function () {
  const ONE = hre.ethers.parseUnits("1", 18);

  async function deploy(funded = true) {
    const [owner, alice, bob] = await hre.ethers.getSigners();
    const nix = await hre.ethers.deployContract("NixToken", ["Nix Token", "NIX", owner.address]);
    await nix.mint(owner.address, 1_000_000n * ONE);
    await nix.mint(alice.address, 10_000n * ONE);
    await nix.mint(bob.address, 10_000n * ONE);
    const omnichain = await deployOmnichain(nix, owner.address, funded ? 5n : 0n);
    const launchpad = omnichain.pads[0];
    const seed = await launchpad.SEED_NIX();
    return { nix, launchpad, owner, alice, bob, seed, omnichain };
  }

  function perChain(supply: bigint) {
    return (supply * 200n) / 10_000n;
  }

  it("lists every launch publicly and allows one active token per wallet", async function () {
    const { nix, launchpad, alice, bob } = await deploy();
    const supply = 1_000_000n * ONE;

    await launchpad.connect(alice).createToken("Alpha", "ALP", supply);
    await expect(launchpad.connect(alice).createToken("Beta", "BETA", supply)).to.be.revertedWithCustomError(
      launchpad,
      "ActiveTokenExists"
    );

    await launchpad.connect(bob).createToken("Beta", "BETA", supply);
    expect(await launchpad.tokenCount()).to.equal(2);

    const listed = await launchpad.allTokens();
    expect(listed.map((launch) => launch.symbol)).to.deep.equal(["ALP", "BETA"]);
    expect(listed[0].creator).to.equal(alice.address);
    expect(listed[0].active).to.equal(true);
    expect(listed[1].creator).to.equal(bob.address);

    const alpha = await hre.ethers.getContractAt("LaunchToken", listed[0].token);
    const liquidityTokens = perChain(supply);
    const creatorAmount = supply - liquidityTokens * 3n;
    expect(await alpha.balanceOf(alice.address)).to.equal(creatorAmount);
    expect(await alpha.balanceOf(await launchpad.getAddress())).to.equal(0n);
    expect(await alpha.totalSupply()).to.equal(creatorAmount + liquidityTokens);
    expect(await nix.balanceOf(alice.address)).to.equal(10_000n * ONE);
    const alphaPair = await hre.ethers.getContractAt("NixPair", listed[0].pair);
    expect(await alpha.balanceOf(await alphaPair.getAddress())).to.equal(liquidityTokens);
    expect(await alphaPair.reserveToken()).to.equal(liquidityTokens);
    expect(await alphaPair.reserveNix()).to.equal(await launchpad.SEED_NIX());
    expect(await alphaPair.priceX18()).to.be.greaterThan(0n);

    await launchpad.connect(alice).retire(0);
    const after = await launchpad.allTokens();
    expect(after[0].active).to.equal(false);
    expect(after[0].token).to.equal(listed[0].token);

    await launchpad.connect(alice).createToken("Gamma", "GAM", supply);
    expect(await launchpad.tokenCount()).to.equal(3);
    expect((await launchpad.activeLaunchOf(alice.address)).active).to.equal(true);
  });

  it("locks the opening liquidity and lets a later deposit be withdrawn", async function () {
    const { nix, launchpad, alice, bob, seed } = await deploy();
    const supply = 1_000_000n * ONE;
    await launchpad.connect(alice).createToken("Alpha", "ALP", supply);
    const listed = await launchpad.allTokens();
    const token = await hre.ethers.getContractAt("LaunchToken", listed[0].token);
    const pair = await hre.ethers.getContractAt("NixPair", listed[0].pair);
    const liquidityTokens = perChain(supply);
    const locked = await pair.liquidityOf(await launchpad.getAddress());

    expect(await pair.reserveNix()).to.equal(seed);
    expect(await pair.reserveToken()).to.equal(liquidityTokens);
    expect(await pair.priceX18()).to.equal((seed * 10n ** 18n) / liquidityTokens);
    expect(locked).to.be.greaterThan(0n);
    expect(await pair.liquidityOf(alice.address)).to.equal(0n);
    await expect(pair.connect(alice).removeLiquidity(locked)).to.be.revertedWithCustomError(
      pair,
      "InsufficientShares"
    );

    await nix.connect(alice).approve(await pair.getAddress(), hre.ethers.MaxUint256);
    await token.connect(alice).approve(await pair.getAddress(), hre.ethers.MaxUint256);
    await pair.connect(alice).addLiquidity(seed, liquidityTokens);
    expect(await pair.reserveNix()).to.equal(seed * 2n);
    expect(await pair.reserveToken()).to.equal(liquidityTokens * 2n);

    const aliceShares = await pair.liquidityOf(alice.address);
    await pair.connect(alice).removeLiquidity(aliceShares);
    expect(await pair.liquidityOf(alice.address)).to.equal(0n);
    expect(await pair.liquidityOf(await launchpad.getAddress())).to.equal(locked);
    expect(await pair.reserveNix()).to.equal(seed);
    expect(await pair.reserveToken()).to.equal(liquidityTokens);

    await token.connect(alice).transfer(bob.address, liquidityTokens);
    await nix.connect(bob).approve(await pair.getAddress(), hre.ethers.MaxUint256);
    await token.connect(bob).approve(await pair.getAddress(), hre.ethers.MaxUint256);
    await pair.connect(bob).addLiquidity(seed, liquidityTokens);
    const bobShares = await pair.liquidityOf(bob.address);
    await expect(pair.connect(alice).removeLiquidity(bobShares)).to.be.revertedWithCustomError(
      pair,
      "InsufficientShares"
    );
    await pair.connect(bob).removeLiquidity(bobShares);
    expect(await pair.reserveNix()).to.equal(seed);
  });

  it("swaps against the seeded reserves and enforces the minimum output", async function () {
    const { nix, launchpad, alice, seed } = await deploy();
    const supply = 1_000_000n * ONE;
    await launchpad.connect(alice).createToken("Nova", "NOVA", supply);
    const listed = await launchpad.allTokens();
    const token = await hre.ethers.getContractAt("LaunchToken", listed[0].token);
    const pair = await hre.ethers.getContractAt("NixPair", listed[0].pair);
    const pairAddress = await pair.getAddress();
    const nixAddress = await nix.getAddress();
    const tokenAddress = await token.getAddress();
    const liquidityTokens = perChain(supply);

    const nixIn = 1n * ONE;
    const tokenOut = await pair.quoteSwap(nixAddress, nixIn);
    expect(tokenOut).to.equal((liquidityTokens * nixIn) / (seed + nixIn));
    await expect(pair.connect(alice).swap(nixAddress, nixIn, tokenOut + 1n, alice.address)).to.be.revertedWithCustomError(
      pair,
      "InsufficientOutput"
    );
    await expect(pair.quoteSwap(alice.address, nixIn)).to.be.revertedWithCustomError(pair, "UnknownToken");

    await nix.connect(alice).approve(pairAddress, nixIn);
    const tokensBefore = await token.balanceOf(alice.address);
    await pair.connect(alice).swap(nixAddress, nixIn, tokenOut, alice.address);
    expect(await token.balanceOf(alice.address)).to.equal(tokensBefore + tokenOut);
    expect(await pair.reserveNix()).to.equal(seed + nixIn);
    expect(await pair.reserveToken()).to.equal(liquidityTokens - tokenOut);
    expect(await nix.balanceOf(alice.address)).to.equal(10_000n * ONE - nixIn);

    const tokenIn = 1_000n * ONE;
    const nixOut = await pair.quoteSwap(tokenAddress, tokenIn);
    await token.connect(alice).approve(pairAddress, tokenIn);
    await pair.connect(alice).swap(tokenAddress, tokenIn, nixOut, alice.address);
    expect(await nix.balanceOf(alice.address)).to.equal(10_000n * ONE - nixIn + nixOut);
    expect(await pair.reserveToken()).to.equal(liquidityTokens - tokenOut + tokenIn);
    expect(await pair.reserveNix()).to.equal(seed + nixIn - nixOut);
  });

  it("reverts while the launchpad cannot fund the NIX side of the pool", async function () {
    const { launchpad, alice } = await deploy(false);
    await expect(launchpad.connect(alice).createToken("Alpha", "ALP", 1_000_000n * ONE)).to.be.revertedWithCustomError(
      launchpad,
      "InsufficientSeed"
    );
    await expect(launchpad.fundSeed(0)).to.be.revertedWithCustomError(launchpad, "ZeroSeed");
  });

  it("refuses a launch until both remote chains are wired", async function () {
    const { nix, owner, alice } = await deploy(false);
    const endpoint = await hre.ethers.deployContract("MockLayerZeroEndpoint", [40231]);
    const tokenFactory = await hre.ethers.deployContract("LaunchFactory");
    const lone = await hre.ethers.deployContract("NixLaunchpad", [
      await nix.getAddress(),
      await endpoint.getAddress(),
      40231,
      await tokenFactory.getAddress(),
      owner.address,
    ]);
    await tokenFactory.setLaunchpad(await lone.getAddress());
    const seed = await lone.SEED_NIX();
    await nix.connect(owner).approve(await lone.getAddress(), seed);
    await lone.fundSeed(seed);
    await expect(lone.connect(alice).createToken("Alpha", "ALP", 1_000_000n * ONE)).to.be.revertedWithCustomError(
      lone,
      "RemotesNotConfigured"
    );
  });

  it("seeds 2% on every chain and burns on the source when the peer mints", async function () {
    const { nix, launchpad, alice, bob, seed, omnichain } = await deploy();
    const supply = 1_000_000n * ONE;
    const liquidity = perChain(supply);
    await launchpad.connect(alice).createToken("Alpha", "ALP", supply);
    const listed = await launchpad.allTokens();
    const sourceToken = await hre.ethers.getContractAt("LaunchToken", listed[0].token);
    const fee = await launchpad.quoteRelay(0);
    expect(fee).to.equal(hre.ethers.parseEther("0.002"));
    await launchpad.connect(alice).relay(0, { value: fee });

    const sourceEndpoint = omnichain.endpoints[0];
    expect(await sourceEndpoint.sentCount()).to.equal(2);

    for (let index = 0; index < 2; index++) {
      const sent = await sourceEndpoint.sentMessage(index);
      const destIndex = omnichain.eids.findIndex((eid) => eid === Number(sent.dstEid));
      expect(destIndex).to.be.greaterThan(0);
      const destPad = omnichain.pads[destIndex];
      const destEndpoint = omnichain.endpoints[destIndex];
      await destEndpoint.deliver(
        await destPad.getAddress(),
        omnichain.eids[0],
        await launchpad.getAddress(),
        sent.guid,
        sent.nonce,
        sent.message
      );
      const predicted = await launchpad.predictRemoteToken(0, sent.dstEid);
      expect(await sourceToken.peers(sent.dstEid)).to.equal(hre.ethers.zeroPadValue(predicted, 32));
      await destPad.finalizeRemote(omnichain.eids[0], 0);
      const mirrored = await destPad.allTokens();
      expect(mirrored[0].token).to.equal(predicted);
      expect(mirrored[0].creator).to.equal(alice.address);
      expect(await destPad.mirrored(0)).to.equal(true);
      const destToken = await hre.ethers.getContractAt("LaunchToken", mirrored[0].token);
      const destPair = await hre.ethers.getContractAt("NixPair", mirrored[0].pair);
      expect(await destToken.totalSupply()).to.equal(liquidity);
      expect(await destPair.reserveToken()).to.equal(liquidity);
      expect(await destPair.reserveNix()).to.equal(seed);
      expect(await destToken.peers(omnichain.eids[0])).to.equal(
        hre.ethers.zeroPadValue(await sourceToken.getAddress(), 32)
      );
      expect(await nix.balanceOf(await destPad.getAddress())).to.equal(seed * 4n);
    }

    const creatorAmount = supply - liquidity * 3n;
    expect(await sourceToken.balanceOf(alice.address)).to.equal(creatorAmount);
    const mirroredSupply = liquidity * 2n;
    expect((await sourceToken.totalSupply()) + mirroredSupply).to.equal(supply);

    const destinationEid = omnichain.eids[1];
    const amount = 1_000n * ONE;
    const bridgeFee = await sourceToken.quoteSend(destinationEid, bob.address, amount);
    await sourceToken.connect(alice).send(destinationEid, bob.address, amount, { value: bridgeFee });
    const bridge = await sourceEndpoint.sentMessage(2);
    const destToken = await hre.ethers.getContractAt(
      "LaunchToken",
      await launchpad.predictRemoteToken(0, destinationEid)
    );
    await omnichain.endpoints[1].deliver(
      await destToken.getAddress(),
      omnichain.eids[0],
      await sourceToken.getAddress(),
      bridge.guid,
      bridge.nonce,
      bridge.message
    );

    expect(await sourceToken.balanceOf(alice.address)).to.equal(creatorAmount - amount);
    expect(await destToken.balanceOf(bob.address)).to.equal(amount);
    expect(await destToken.totalSupply()).to.equal(liquidity + amount);
    expect((await sourceToken.totalSupply()) + (await destToken.totalSupply()) + liquidity).to.equal(supply);

    await expect(
      omnichain.endpoints[1].deliver(
        await destToken.getAddress(),
        omnichain.eids[0],
        await sourceToken.getAddress(),
        bridge.guid,
        bridge.nonce,
        bridge.message
      )
    ).to.be.revertedWithCustomError(destToken, "AlreadyExecuted");
    await expect(
      destToken.connect(alice).lzReceive(
        { srcEid: omnichain.eids[0], sender: hre.ethers.zeroPadValue(alice.address, 32), nonce: 9 },
        hre.ethers.id("nope"),
        bridge.message,
        alice.address,
        "0x"
      )
    ).to.be.revertedWithCustomError(destToken, "OnlyEndpoint");
  });
});
