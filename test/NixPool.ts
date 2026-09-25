import { expect } from "chai";
import hre from "hardhat";
import { CofheClient, Encryptable, FheTypes } from "@cofhe/sdk";

describe("NixPool", function () {
  const ONE = hre.ethers.parseUnits("1", 18);

  async function deploy() {
    const [owner, alice, bob, stranger] = await hre.ethers.getSigners();
    const token = await hre.ethers.deployContract("NixToken", ["Nix Token", "NIX", owner.address]);
    const pool = await hre.ethers.deployContract("NixPool", [await token.getAddress()]);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    const strangerClient = await hre.cofhe.createClientWithBatteries(stranger);

    await token.connect(owner).mint(alice.address, 1_000n * ONE);
    await token.connect(owner).mint(bob.address, 1_000n * ONE);
    await token.connect(alice).approve(await pool.getAddress(), hre.ethers.MaxUint256);
    await token.connect(bob).approve(await pool.getAddress(), hre.ethers.MaxUint256);

    return { token, pool, alice, bob, stranger, aliceClient, bobClient, strangerClient };
  }

  async function encryptShares(client: CofheClient, poolAddress: string, shares: bigint) {
    const [handle, proof] = await client
      .encryptInputs([Encryptable.uint64(shares)])
      .setConsumingContract(poolAddress)
      .execute();
    return { handle, proof };
  }

  it("keeps the public reserve equal to deposits while share balances stay encrypted", async function () {
    const { token, pool, alice, bob, stranger, aliceClient, bobClient, strangerClient } = await deploy();

    await pool.connect(alice).depositLiquidity(500n * ONE);
    await pool.connect(bob).depositLiquidity(125n * ONE);

    expect(await pool.totalReserve()).to.equal(625n * ONE);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(625n * ONE);

    const aliceShares = await pool.liquidityOf(alice.address);
    const bobShares = await pool.liquidityOf(bob.address);
    expect(aliceShares).to.not.equal(hre.ethers.ZeroHash);
    expect(bobShares).to.not.equal(hre.ethers.ZeroHash);
    expect(aliceShares).to.not.equal(bobShares);

    expect(await pool.isShareReadableBy(alice.address, alice.address)).to.equal(true);
    expect(await pool.isShareReadableBy(alice.address, bob.address)).to.equal(false);
    expect(await pool.isShareReadableBy(alice.address, stranger.address)).to.equal(false);
    expect(await pool.isShareReadableBy(bob.address, stranger.address)).to.equal(false);

    expect(await aliceClient.decryptForView(aliceShares, FheTypes.Uint64).execute()).to.equal(500n * 10n ** 6n);
    expect(await bobClient.decryptForView(bobShares, FheTypes.Uint64).execute()).to.equal(125n * 10n ** 6n);
    await expect(strangerClient.decryptForView(aliceShares, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(bobClient.decryptForView(aliceShares, FheTypes.Uint64).execute()).to.be.rejected;
  });

  it("burns encrypted shares and only then reduces the public reserve", async function () {
    const { token, pool, alice, stranger, aliceClient, strangerClient } = await deploy();
    await pool.connect(alice).depositLiquidity(200n * ONE);

    const burnedShares = 40n * 10n ** 6n;
    const encrypted = await encryptShares(aliceClient, await pool.getAddress(), burnedShares);
    const tx = await pool
      .connect(alice)
      .getFunction("withdrawLiquidity(bytes32,bytes)")(encrypted.handle, encrypted.proof);
    const receipt = await tx.wait();
    const withdrawn = receipt?.logs
      .map((log) => {
        try {
          return pool.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "LiquidityWithdrawn");

    expect(await pool.totalReserve()).to.equal(200n * ONE);
    expect(withdrawn?.args.burnedShares).to.be.a("string");
    expect(withdrawn?.args.burnedShares).to.not.equal(hre.ethers.toBeHex(burnedShares, 32));

    const [withdrawal] = await pool.pendingWithdrawals(alice.address);
    expect(withdrawal.claimed).to.equal(false);

    const revealed = await aliceClient.decryptForTx(withdrawal.ctHash).withACP().execute();
    await pool.claimLiquidity(withdrawal.claimId, revealed.decryptedValue, revealed.signature);

    expect(await pool.totalReserve()).to.equal(160n * ONE);
    expect(await token.balanceOf(alice.address)).to.equal(840n * ONE);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(160n * ONE);
    expect(await pool.pendingWithdrawals(alice.address)).to.deep.equal([]);

    const remaining = await pool.liquidityOf(alice.address);
    expect(await aliceClient.decryptForView(remaining, FheTypes.Uint64).execute()).to.equal(160n * 10n ** 6n);
    expect(await pool.isShareReadableBy(alice.address, stranger.address)).to.equal(false);
    await expect(strangerClient.decryptForView(remaining, FheTypes.Uint64).execute()).to.be.rejected;
  });
});
