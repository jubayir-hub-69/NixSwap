import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployOmnichain } from "./omnichainFixture";

const ONE = hre.ethers.parseUnits("1", 18);
const CONFIDENTIAL = 1_000_000n;

describe("Swap fill", function () {
  async function deploy() {
    const [owner, alice, solver, stranger] = await hre.ethers.getSigners();
    const nix = await hre.ethers.deployContract("NixToken", ["Nix Token", "NIX", owner.address]);
    await nix.mint(owner.address, 1_000_000n * ONE);
    await nix.mint(alice.address, 10_000n * ONE);
    const { pads } = await deployOmnichain(nix, owner.address, 1n);
    const launchpad = pads[0];
    const seed = await launchpad.SEED_NIX();
    const registry = await hre.ethers.deployContract("IntentRegistry", [owner.address]);
    await registry.connect(owner).setSolver(solver.address, true);

    const supply = 1_000_000n * ONE;
    await launchpad.connect(alice).createToken("Nova", "NOVA", supply);
    const listed = await launchpad.allTokens();
    const token = await hre.ethers.getContractAt("LaunchToken", listed[0].token);
    const pair = await hre.ethers.getContractAt("NixPair", listed[0].pair);
    await nix.connect(alice).approve(await registry.getAddress(), hre.ethers.MaxUint256);

    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const solverClient = await hre.cofhe.createClientWithBatteries(solver);
    const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
    return { nix, token, pair, registry, alice, solver, stranger, aliceClient, solverClient, chainId, seed, supply };
  }

  async function submit(
    fixture: Awaited<ReturnType<typeof deploy>>,
    amount: bigint,
    limit: bigint,
    expiresAt: bigint,
    intentType = 0
  ) {
    const [encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof] = await fixture.aliceClient
      .encryptInputs([
        Encryptable.uint64(amount),
        Encryptable.uint32(fixture.chainId),
        Encryptable.uint64(limit),
      ])
      .setConsumingContract(await fixture.registry.getAddress())
      .execute();

    const tx = await fixture.registry.connect(fixture.alice).submitSwapIntent(
      await fixture.nix.getAddress(),
      await fixture.token.getAddress(),
      intentType,
      encryptedAmount,
      encryptedTargetChain,
      encryptedLimit,
      inputProof,
      fixture.solver.address,
      expiresAt
    );
    const receipt = await tx.wait();
    const id = await fixture.registry.intentCount();
    return { id, receipt };
  }

  async function revealed(fixture: Awaited<ReturnType<typeof deploy>>, intentId: bigint) {
    await fixture.registry.connect(fixture.solver).grantSolverAccess(intentId);
    const intent = await fixture.registry.getIntent(intentId);
    const amount = await fixture.solverClient.decryptForTx(intent.amount).withACP().execute();
    const limit = await fixture.solverClient.decryptForTx(intent.limit).withACP().execute();
    const targetChain = await fixture.solverClient.decryptForTx(intent.targetChain).withACP().execute();
    return { amount, limit, targetChain };
  }

  async function fill(
    fixture: Awaited<ReturnType<typeof deploy>>,
    intentId: bigint,
    proof: Awaited<ReturnType<typeof revealed>>,
    signer: Awaited<ReturnType<typeof deploy>>["solver"] | Awaited<ReturnType<typeof deploy>>["stranger"] = fixture.solver
  ) {
    return fixture.registry.connect(signer).fillSwap(
      {
        intentId,
        pair: await fixture.pair.getAddress(),
        amount: proof.amount.decryptedValue,
        limit: proof.limit.decryptedValue,
        targetChain: proof.targetChain.decryptedValue,
      },
      proof.amount.signature,
      proof.limit.signature,
      proof.targetChain.signature
    );
  }

  it("moves the trader's balances only when the designated solver fills", async function () {
    const fixture = await deploy();
    const latest = await time.latest();
    const { id, receipt } = await submit(fixture, CONFIDENTIAL, CONFIDENTIAL, BigInt(latest + 600));
    expect(JSON.stringify(receipt?.logs ?? [])).to.not.include(CONFIDENTIAL.toString());

    const nixIn = CONFIDENTIAL * (await fixture.registry.CONFIDENTIAL_TO_PUBLIC());
    const expected = await fixture.pair.quoteSwap(await fixture.nix.getAddress(), nixIn);
    const nixBefore = await fixture.nix.balanceOf(fixture.alice.address);
    const tokenBefore = await fixture.token.balanceOf(fixture.alice.address);
    const proof = await revealed(fixture, id);

    expect(proof.amount.decryptedValue).to.equal(CONFIDENTIAL);
    expect(proof.limit.decryptedValue).to.equal(CONFIDENTIAL);
    expect(proof.targetChain.decryptedValue).to.equal(BigInt(fixture.chainId));

    await fill(fixture, id, proof);
    expect(await fixture.nix.balanceOf(fixture.alice.address)).to.equal(nixBefore - nixIn);
    expect(await fixture.token.balanceOf(fixture.alice.address)).to.equal(tokenBefore + expected);
    expect(await fixture.pair.reserveNix()).to.equal(fixture.seed + nixIn);
    expect(await fixture.nix.balanceOf(await fixture.registry.getAddress())).to.equal(0n);
    expect((await fixture.registry.getIntent(id)).active).to.equal(false);

    await expect(fill(fixture, id, proof)).to.be.revertedWithCustomError(fixture.registry, "IntentInactive");
  });

  it("rejects the wrong caller, a bad proof, a minimum above the pool, and an expired order", async function () {
    const fixture = await deploy();
    const latest = await time.latest();
    const goodUntil = BigInt(latest + 3_000);
    const soon = BigInt(latest + 90);
    const { id: payableId } = await submit(fixture, CONFIDENTIAL, CONFIDENTIAL, goodUntil);
    const { id: richId } = await submit(fixture, CONFIDENTIAL, 1_000n * CONFIDENTIAL, goodUntil);
    const { id: expiringId } = await submit(fixture, CONFIDENTIAL, CONFIDENTIAL, soon);

    await expect(
      fixture.registry.connect(fixture.stranger).fillSwap(
        {
          intentId: payableId,
          pair: await fixture.pair.getAddress(),
          amount: 1,
          limit: 1,
          targetChain: fixture.chainId,
        },
        "0x",
        "0x",
        "0x"
      )
    ).to.be.revertedWithCustomError(fixture.registry, "SolverNotDesignated");

    const payableProof = await revealed(fixture, payableId);
    await expect(
      fixture.registry.connect(fixture.solver).fillSwap(
        {
          intentId: payableId,
          pair: await fixture.pair.getAddress(),
          amount: payableProof.amount.decryptedValue + 1n,
          limit: payableProof.limit.decryptedValue,
          targetChain: payableProof.targetChain.decryptedValue,
        },
        payableProof.amount.signature,
        payableProof.limit.signature,
        payableProof.targetChain.signature
      )
    ).to.be.revertedWithCustomError(fixture.registry, "InvalidDecryptionProof");

    const richProof = await revealed(fixture, richId);
    await expect(fill(fixture, richId, richProof)).to.be.revertedWithCustomError(fixture.registry, "LimitNotMet");
    expect((await fixture.registry.getIntent(richId)).active).to.equal(true);
    expect(await fixture.nix.balanceOf(fixture.alice.address)).to.equal(10_000n * ONE);

    await time.increaseTo(soon + 1n);
    await expect(fill(fixture, expiringId, payableProof)).to.be.revertedWithCustomError(
      fixture.registry,
      "IntentExpired"
    );
    expect(await fixture.registry.isIntentReadableBy(expiringId, fixture.solver.address)).to.equal(false);
  });
});
