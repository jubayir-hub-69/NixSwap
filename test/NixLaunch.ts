import { expect } from "chai";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("NixLaunch", function () {
  const BASE_PRICE = 2n;
  const CURVE_STEP = 1000n;
  const ALICE_AMOUNT = 50n;
  const ALICE_LIMIT = 10n;
  const WHALE_AMOUNT = 150n;
  const WHALE_LIMIT = 10n;
  const LOSER_AMOUNT = 80n;
  const LOSER_LIMIT = 1n;

  async function deploy() {
    const [deployer, alice, whale, bob] = await hre.ethers.getSigners();
    const payment = await hre.ethers.deployContract("NixToken", ["Nix Payment", "nPAY", deployer.address]);
    const sale = await hre.ethers.deployContract("NixToken", ["Nix Sale", "nSALE", deployer.address]);
    const biddingEnd = (await time.latest()) + 3600;
    const launch = await hre.ethers.deployContract("NixLaunch", [
      await payment.getAddress(),
      await sale.getAddress(),
      1_000n,
      BASE_PRICE,
      CURVE_STEP,
      biddingEnd,
    ]);

    for (const account of [alice, whale, bob]) {
      await payment.connect(deployer).mint(account.address, 1_000n);
      await payment.connect(account).approve(await launch.getAddress(), hre.ethers.MaxUint256);
    }
    await sale.connect(deployer).mint(await launch.getAddress(), 1_000n);

    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const whaleClient = await hre.cofhe.createClientWithBatteries(whale);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    const deployerClient = await hre.cofhe.createClientWithBatteries(deployer);

    return {
      deployer,
      alice,
      whale,
      bob,
      payment,
      sale,
      launch,
      biddingEnd,
      aliceClient,
      whaleClient,
      bobClient,
      deployerClient,
    };
  }

  async function commit(
    launch: Awaited<ReturnType<typeof deploy>>["launch"],
    client: Awaited<ReturnType<typeof deploy>>["aliceClient"],
    signer: Awaited<ReturnType<typeof deploy>>["alice"],
    amount: bigint,
    limit: bigint
  ) {
    const [encryptedAmount, encryptedLimit, inputProof] = await client
      .encryptInputs([Encryptable.uint64(amount), Encryptable.uint64(limit)])
      .setConsumingContract(await launch.getAddress())
      .execute();
    await launch.connect(signer).submitBid(encryptedAmount, encryptedLimit, inputProof);
  }

  it("hides the book and the total from a whale until the window closes", async function () {
    const { deployer, alice, whale, bob, launch, biddingEnd, aliceClient, whaleClient, bobClient, deployerClient } =
      await deploy();

    await commit(launch, aliceClient, alice, ALICE_AMOUNT, ALICE_LIMIT);
    await commit(launch, whaleClient, whale, WHALE_AMOUNT, WHALE_LIMIT);
    await commit(launch, bobClient, bob, LOSER_AMOUNT, LOSER_LIMIT);

    expect(await launch.totalRaised()).to.equal(hre.ethers.ZeroHash);
    expect(await launch.canReadTotal(whale.address)).to.equal(false);
    expect(await launch.canReadTotal(deployer.address)).to.equal(false);
    expect(await launch.canReadBid(bob.address, whale.address)).to.equal(false);
    expect(await launch.canReadBid(bob.address, deployer.address)).to.equal(false);
    expect(await launch.canReadBid(alice.address, whale.address)).to.equal(false);
    expect(await launch.canReadBid(whale.address, bob.address)).to.equal(false);

    const [loserAmount] = await launch.bidOf(bob.address);
    const [aliceAmount] = await launch.bidOf(alice.address);
    await expect(whaleClient.decryptForView(loserAmount, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(whaleClient.decryptForView(aliceAmount, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(deployerClient.decryptForView(loserAmount, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(bobClient.decryptForView(aliceAmount, FheTypes.Uint64).execute()).to.be.rejected;

    await expect(launch.connect(whale).settleLaunch()).to.be.revertedWithCustomError(launch, "BiddingStillActive");

    await time.increaseTo(biddingEnd);
    await launch.settleLaunch();

    expect(await launch.canReadBid(bob.address, whale.address)).to.equal(false);
    expect(await launch.canReadBid(bob.address, deployer.address)).to.equal(false);
    expect(await launch.canReadBid(alice.address, whale.address)).to.equal(false);
    await expect(whaleClient.decryptForView(loserAmount, FheTypes.Uint64).execute()).to.be.rejected;

    const totalHandle = await launch.totalRaised();
    const priceHandle = await launch.clearingPriceHandle();
    expect(await launch.canReadTotal(whale.address)).to.equal(true);
    const total = await whaleClient.decryptForTx(totalHandle).withoutACP().execute();
    const price = await whaleClient.decryptForTx(priceHandle).withoutACP().execute();
    expect(total.decryptedValue).to.equal(ALICE_AMOUNT + WHALE_AMOUNT + LOSER_AMOUNT);
    expect(price.decryptedValue).to.equal(BASE_PRICE);

    await launch.finalizeLaunch(total.decryptedValue, total.signature, price.decryptedValue, price.signature);
    expect(await launch.revealedTotal()).to.equal(280n);
    expect(await launch.clearingPrice()).to.equal(BASE_PRICE);
    await expect(whaleClient.decryptForView(loserAmount, FheTypes.Uint64).execute()).to.be.rejected;
  });

  it("allocates winners from the sealed total and leaves the losing bid sealed", async function () {
    const { alice, whale, bob, payment, sale, launch, biddingEnd, aliceClient, whaleClient, bobClient } =
      await deploy();

    await commit(launch, aliceClient, alice, ALICE_AMOUNT, ALICE_LIMIT);
    await commit(launch, whaleClient, whale, WHALE_AMOUNT, WHALE_LIMIT);
    await commit(launch, bobClient, bob, LOSER_AMOUNT, LOSER_LIMIT);
    await time.increaseTo(biddingEnd);
    await launch.settleLaunch();

    const total = await aliceClient.decryptForTx(await launch.totalRaised()).withoutACP().execute();
    const price = await aliceClient.decryptForTx(await launch.clearingPriceHandle()).withoutACP().execute();
    await launch.finalizeLaunch(total.decryptedValue, total.signature, price.decryptedValue, price.signature);

    const aliceAllocation = await launch.allocationOf(alice.address);
    const whaleAllocation = await launch.allocationOf(whale.address);
    const loserAllocation = await launch.allocationOf(bob.address);

    expect(await aliceClient.decryptForView(aliceAllocation, FheTypes.Uint64).execute()).to.equal(25n);
    expect(await whaleClient.decryptForView(whaleAllocation, FheTypes.Uint64).execute()).to.equal(75n);
    expect(await bobClient.decryptForView(loserAllocation, FheTypes.Uint64).execute()).to.equal(0n);
    await expect(whaleClient.decryptForView(loserAllocation, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(
      whaleClient.decryptForView((await launch.bidOf(bob.address))[0], FheTypes.Uint64).execute()
    ).to.be.rejected;

    const aliceClaim = await aliceClient.decryptForTx(aliceAllocation).withACP().execute();
    await launch.connect(alice).claim(aliceClaim.decryptedValue, aliceClaim.signature);
    const whaleClaim = await whaleClient.decryptForTx(whaleAllocation).withACP().execute();
    await launch.connect(whale).claim(whaleClaim.decryptedValue, whaleClaim.signature);
    const loserClaim = await bobClient.decryptForTx(loserAllocation).withACP().execute();
    await launch.connect(bob).claim(loserClaim.decryptedValue, loserClaim.signature);

    expect(await sale.balanceOf(alice.address)).to.equal(25n);
    expect(await sale.balanceOf(whale.address)).to.equal(75n);
    expect(await sale.balanceOf(bob.address)).to.equal(0n);
    expect(await payment.balanceOf(alice.address)).to.equal(950n);
    expect(await payment.balanceOf(whale.address)).to.equal(850n);
    expect(await payment.balanceOf(bob.address)).to.equal(1_000n);
    expect(await launch.canReadBid(bob.address, whale.address)).to.equal(false);
  });
});
