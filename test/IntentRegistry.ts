import { expect } from "chai";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("IntentRegistry", function () {
  async function deploy() {
    const [owner, user, solver, stranger] = await hre.ethers.getSigners();
    const registry = await hre.ethers.deployContract("IntentRegistry", [owner.address]);
    await registry.connect(owner).setSolver(solver.address, true);

    const userClient = await hre.cofhe.createClientWithBatteries(user);
    const solverClient = await hre.cofhe.createClientWithBatteries(solver);
    const strangerClient = await hre.cofhe.createClientWithBatteries(stranger);

    return { registry, owner, user, solver, stranger, userClient, solverClient, strangerClient };
  }

  async function submitSample(
    registry: Awaited<ReturnType<typeof deploy>>["registry"],
    userClient: Awaited<ReturnType<typeof deploy>>["userClient"],
    user: Awaited<ReturnType<typeof deploy>>["user"],
    solver: Awaited<ReturnType<typeof deploy>>["solver"],
    expiresAt: bigint
  ) {
    const amount = 1_500_000n;
    const targetChain = 84532;
    const limit = 900_000n;
    const [encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof] = await userClient
      .encryptInputs([
        Encryptable.uint64(amount),
        Encryptable.uint32(targetChain),
        Encryptable.uint64(limit),
      ])
      .setConsumingContract(await registry.getAddress())
      .execute();

    const tx = await registry
      .connect(user)
      .submitIntent(0, encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof, solver.address, expiresAt);
    const receipt = await tx.wait();
    return { amount, targetChain, limit, receipt };
  }

  it("lets only the designated solver decrypt the intent inside the window", async function () {
    const { registry, user, solver, stranger, userClient, solverClient, strangerClient } = await deploy();
    const latest = await time.latest();
    const expiresAt = BigInt(latest + 600);
    const { amount, targetChain, limit, receipt } = await submitSample(
      registry,
      userClient,
      user,
      solver,
      expiresAt
    );

    expect(JSON.stringify(receipt?.logs ?? [])).to.not.include(amount.toString());
    expect(await registry.isIntentReadableBy(1, solver.address)).to.equal(false);
    expect(await registry.isIntentReadableBy(1, user.address)).to.equal(false);
    expect(await registry.isIntentReadableBy(1, stranger.address)).to.equal(false);

    await registry.connect(solver).grantSolverAccess(1);

    expect(await registry.isIntentReadableBy(1, solver.address)).to.equal(true);
    expect(await registry.isIntentReadableBy(1, user.address)).to.equal(false);
    expect(await registry.isIntentReadableBy(1, stranger.address)).to.equal(false);

    const intent = await registry.getIntent(1);
    expect(await solverClient.decryptForView(intent.amount, FheTypes.Uint64).execute()).to.equal(amount);
    expect(await solverClient.decryptForView(intent.targetChain, FheTypes.Uint32).execute()).to.equal(
      BigInt(targetChain)
    );
    expect(await solverClient.decryptForView(intent.limit, FheTypes.Uint64).execute()).to.equal(limit);

    await expect(userClient.decryptForView(intent.amount, FheTypes.Uint64).execute()).to.be.rejected;
    await expect(strangerClient.decryptForView(intent.amount, FheTypes.Uint64).execute()).to.be.rejected;
  });

  it("refuses solver access after the window and refuses a non-whitelisted solver", async function () {
    const { registry, owner, user, solver, stranger, userClient } = await deploy();
    const latest = await time.latest();
    const expiresAt = BigInt(latest + 60);

    await expect(
      submitSample(registry, userClient, user, stranger, expiresAt)
    ).to.be.revertedWithCustomError(registry, "SolverNotWhitelisted");

    await submitSample(registry, userClient, user, solver, expiresAt);
    await time.increaseTo(expiresAt + 1n);

    await expect(registry.connect(solver).grantSolverAccess(1)).to.be.revertedWithCustomError(
      registry,
      "IntentExpired"
    );
    expect(await registry.isIntentReadableBy(1, solver.address)).to.equal(false);

    await registry.connect(owner).setSolver(solver.address, false);
    expect(await registry.isSolver(solver.address)).to.equal(false);
  });
});
