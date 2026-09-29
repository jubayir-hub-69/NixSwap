import { expect } from "chai";
import hre from "hardhat";

describe("NixLaunchpad", function () {
  const ONE = hre.ethers.parseUnits("1", 18);

  async function deploy(funded = true) {
    const [owner, alice, bob] = await hre.ethers.getSigners();
    const nix = await hre.ethers.deployContract("NixToken", ["Nix Token", "NIX", owner.address]);
    await nix.mint(owner.address, 1_000_000n * ONE);
    await nix.mint(alice.address, 10_000n * ONE);
    await nix.mint(bob.address, 10_000n * ONE);
    const launchpad = await hre.ethers.deployContract("NixLaunchpad", [await nix.getAddress()]);
    const seed = await launchpad.SEED_NIX();
    if (funded) {
      const budget = seed * 5n;
      await nix.connect(owner).approve(await launchpad.getAddress(), budget);
      await launchpad.connect(owner).fundSeed(budget);
    }
    return { nix, launchpad, owner, alice, bob, seed };
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
    const liquidityTokens = supply * 200n / 10_000n;
    expect(await alpha.balanceOf(alice.address)).to.equal(supply - liquidityTokens);
    expect(await alpha.balanceOf(await launchpad.getAddress())).to.equal(0n);
    expect(await alpha.totalSupply()).to.equal(supply);
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
    const liquidityTokens = supply * 200n / 10_000n;
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
    const liquidityTokens = supply * 200n / 10_000n;

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
});
