import { expect } from "chai";
import { readFileSync } from "node:fs";
import hre from "hardhat";

const EID_A = 40231;
const EID_B = 40245;
const OPTIONS = "0x0003010011010000000000000000000000000003d090";

async function mine(seconds: number) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

async function fixture() {
  const [owner, alice, bob] = await hre.ethers.getSigners();
  const endpointA = await hre.ethers.deployContract("MockLayerZeroEndpoint", [EID_A]);
  const endpointB = await hre.ethers.deployContract("MockLayerZeroEndpoint", [EID_B]);
  const bridgeA = await hre.ethers.deployContract("NixBridge", [await endpointA.getAddress(), EID_A, owner.address]);
  const bridgeB = await hre.ethers.deployContract("NixBridge", [await endpointB.getAddress(), EID_B, owner.address]);
  const tokenA = await hre.ethers.deployContract("TestERC20", ["Nix Token", "NIX", 18]);
  const tokenB = await hre.ethers.deployContract("TestERC20", ["Nix Token", "NIX", 18]);
  const nixId = await bridgeA.NIX_TOKEN_ID();

  await bridgeA.registerToken(nixId, await tokenA.getAddress());
  await bridgeB.registerToken(nixId, await tokenB.getAddress());
  await bridgeA.setPeer(EID_B, hre.ethers.zeroPadValue(await bridgeB.getAddress(), 32));
  await bridgeB.setPeer(EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32));

  const cap = hre.ethers.parseEther("1000");
  const refill = cap / 3600n;
  await bridgeA.setRateLimit(nixId, EID_B, false, cap, refill);
  await bridgeA.setRateLimit(nixId, EID_B, true, cap, refill);
  await bridgeB.setRateLimit(nixId, EID_A, false, cap, refill);
  await bridgeB.setRateLimit(nixId, EID_A, true, cap, refill);

  const liquidity = hre.ethers.parseEther("100");
  await tokenB.mint(owner.address, liquidity);
  await tokenB.approve(await bridgeB.getAddress(), liquidity);
  await bridgeB.deposit(nixId, liquidity);
  await tokenA.mint(alice.address, hre.ethers.parseEther("50"));

  return { owner, alice, bob, endpointA, endpointB, bridgeA, bridgeB, tokenA, tokenB, nixId, cap };
}

async function packetOf(endpoint: Awaited<ReturnType<typeof fixture>>["endpointA"]) {
  return {
    guid: await endpoint.lastGuid(),
    nonce: await endpoint.outboundNonce(),
    message: await endpoint.lastMessage(),
  };
}

describe("NixBridge", function () {
  let snapshot = "";

  beforeEach(async function () {
    snapshot = await hre.network.provider.send("evm_snapshot");
  });

  afterEach(async function () {
    await hre.network.provider.send("evm_revert", [snapshot]);
  });

  it("locks the exact amount and releases that amount only through the destination endpoint", async function () {
    const { alice, bob, endpointA, endpointB, bridgeA, bridgeB, tokenA, tokenB, nixId } = await fixture();
    const amount = hre.ethers.parseEther("10");
    const fee = hre.ethers.parseEther("0.002");
    await tokenA.connect(alice).approve(await bridgeA.getAddress(), amount);

    const endpointBalance = await hre.ethers.provider.getBalance(await endpointA.getAddress());
    await bridgeA.connect(alice).send(EID_B, nixId, amount, bob.address, { value: fee });

    expect(await hre.ethers.provider.getBalance(await bridgeA.getAddress())).to.equal(0n);
    expect(await hre.ethers.provider.getBalance(await endpointA.getAddress())).to.equal(
      endpointBalance + hre.ethers.parseEther("0.001"),
    );
    expect(await endpointA.lastOptions()).to.equal(OPTIONS);
    expect(await endpointA.lastRefund()).to.equal(alice.address);

    const packet = await packetOf(endpointA);
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256", "uint8"],
      [nixId, bob.address, amount, 18],
    );
    expect(packet.message).to.equal(encoded);
    expect(await bridgeA.accounted(nixId)).to.equal(amount);
    expect(await tokenB.balanceOf(bob.address)).to.equal(0n);

    await endpointB.deliver(
      await bridgeB.getAddress(),
      EID_A,
      await bridgeA.getAddress(),
      packet.guid,
      packet.nonce,
      packet.message,
    );

    expect(await tokenB.balanceOf(bob.address)).to.equal(amount);
    expect(await bridgeB.accounted(nixId)).to.equal(hre.ethers.parseEther("90"));
    expect(await bridgeB.executed(packet.guid)).to.equal(true);
    expect(await bridgeB.inboundNonceUsed(EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32), packet.nonce)).to.equal(
      true,
    );
  });

  it("rejects a replay, a foreign caller, a foreign peer, and a short message", async function () {
    const { alice, bob, endpointA, endpointB, bridgeA, bridgeB, tokenA, nixId } = await fixture();
    const amount = hre.ethers.parseEther("1");
    await tokenA.connect(alice).approve(await bridgeA.getAddress(), amount);
    await bridgeA.connect(alice).send(EID_B, nixId, amount, bob.address, { value: hre.ethers.parseEther("0.001") });
    const packet = await packetOf(endpointA);
    const deliver = async () =>
      endpointB.deliver(
        await bridgeB.getAddress(),
        EID_A,
        await bridgeA.getAddress(),
        packet.guid,
        packet.nonce,
        packet.message,
      );
    await deliver();
    await expect(deliver()).to.be.revertedWithCustomError(bridgeB, "AlreadyExecuted").withArgs(packet.guid);

    await expect(
      bridgeB.connect(alice).lzReceive(
        [EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32), packet.nonce],
        packet.guid,
        packet.message,
        alice.address,
        "0x",
      ),
    ).to.be.revertedWithCustomError(bridgeB, "OnlyEndpoint").withArgs(alice.address);

    await expect(
      endpointB.deliver(await bridgeB.getAddress(), EID_A, alice.address, hre.ethers.ZeroHash, 9n, packet.message),
    ).to.be.revertedWithCustomError(bridgeB, "OnlyPeer");

    await expect(
      endpointB.deliver(await bridgeB.getAddress(), EID_A, await bridgeA.getAddress(), hre.ethers.ZeroHash, 9n, "0x1234"),
    ).to.be.revertedWithCustomError(bridgeB, "InvalidMessage");
  });

  it("refuses to lock tokens when the destination cannot pay them yet", async function () {
    const { alice, bob, owner, endpointA, endpointB, bridgeA, bridgeB, tokenA, tokenB, nixId } = await fixture();
    const dry = await hre.ethers.deployContract("NixBridge", [await endpointB.getAddress(), EID_B, owner.address]);
    await dry.registerToken(nixId, await tokenB.getAddress());
    await dry.setPeer(EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32));
    await dry.setRateLimit(nixId, EID_A, true, hre.ethers.parseEther("1000"), hre.ethers.parseEther("1"));

    const amount = hre.ethers.parseEther("4");
    await tokenA.connect(alice).approve(await bridgeA.getAddress(), amount);
    const dryPeer = hre.ethers.zeroPadValue(await dry.getAddress(), 32);
    await expect(bridgeA.setPeer(EID_B, dryPeer)).to.be.revertedWithCustomError(bridgeA, "PeerAlreadySet");
    await bridgeA.queuePeer(EID_B, dryPeer);
    const delay = await bridgeA.PEER_DELAY();
    await expect(bridgeA.applyPeer(EID_B)).to.be.revertedWithCustomError(bridgeA, "PeerTimelock");
    await mine(Number(delay) + 1);
    await bridgeA.applyPeer(EID_B);

    await bridgeA.connect(alice).send(EID_B, nixId, amount, bob.address, { value: hre.ethers.parseEther("0.001") });
    const packet = await packetOf(endpointA);
    await expect(
      endpointB.deliver(await dry.getAddress(), EID_A, await bridgeA.getAddress(), packet.guid, packet.nonce, packet.message),
    ).to.be.revertedWithCustomError(dry, "InsufficientLiquidity").withArgs(0n, amount);

    await tokenB.mint(owner.address, amount);
    await tokenB.approve(await dry.getAddress(), amount);
    await dry.deposit(nixId, amount);
    await endpointB.deliver(
      await dry.getAddress(),
      EID_A,
      await bridgeA.getAddress(),
      packet.guid,
      packet.nonce,
      packet.message,
    );
    expect(await tokenB.balanceOf(bob.address)).to.equal(amount);
  });

  it("rejects fee-on-transfer tokens, underpayment, and a recipient that cannot take the refund", async function () {
    const { owner, alice, bob, endpointA, bridgeA, tokenA, nixId } = await fixture();
    const feeToken = await hre.ethers.deployContract("FeeOnTransferERC20");
    const feeId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("FEE"));
    await bridgeA.registerToken(feeId, await feeToken.getAddress());
    await bridgeA.setRateLimit(feeId, EID_B, false, hre.ethers.parseEther("100"), 1n);
    const amount = hre.ethers.parseEther("10");
    await feeToken.mint(owner.address, amount);
    await feeToken.approve(await bridgeA.getAddress(), amount);
    await expect(
      bridgeA.send(EID_B, feeId, amount, bob.address, { value: hre.ethers.parseEther("0.001") }),
    ).to.be.revertedWithCustomError(bridgeA, "ExactAmountRequired");
    expect(await bridgeA.accounted(feeId)).to.equal(0n);

    await expect(bridgeA.quoteSend(EID_B, nixId, 0n, bob.address)).to.be.revertedWithCustomError(bridgeA, "ZeroAmount");
    const one = hre.ethers.parseEther("1");
    await tokenA.connect(alice).approve(await bridgeA.getAddress(), one);
    await expect(bridgeA.connect(alice).send(EID_B, nixId, one, bob.address, { value: 1n })).to.be.revertedWithCustomError(
      bridgeA,
      "InsufficientFee",
    );

    const rejector = await hre.ethers.deployContract("RejectingSender", { value: hre.ethers.parseEther("1") });
    const token = await hre.ethers.deployContract("TestERC20", ["Nix Token", "NIX", 18]);
    const rejectId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("REJECT"));
    await bridgeA.registerToken(rejectId, await token.getAddress());
    await bridgeA.setRateLimit(rejectId, EID_B, false, hre.ethers.parseEther("100"), 1n);
    await token.mint(await rejector.getAddress(), amount);
    await expect(
      rejector.approveAndSend(
        await token.getAddress(),
        await bridgeA.getAddress(),
        EID_B,
        rejectId,
        amount,
        bob.address,
        { value: hre.ethers.parseEther("0.002") },
      ),
    ).to.be.revertedWithCustomError(bridgeA, "RefundFailed");
    expect(await token.balanceOf(await rejector.getAddress())).to.equal(amount);
    expect(await bridgeA.accounted(rejectId)).to.equal(0n);
    expect(await endpointA.outboundNonce()).to.equal(0n);
  });

  it("keeps escrow out of the owner withdrawal path and timelocks accidental surplus", async function () {
    const { owner, bridgeB, tokenB, nixId } = await fixture();
    const extra = hre.ethers.parseEther("7");
    await tokenB.mint(owner.address, extra);
    await tokenB.transfer(await bridgeB.getAddress(), extra);
    expect(await bridgeB.surplus(nixId)).to.equal(extra);
    expect(await bridgeB.accounted(nixId)).to.equal(hre.ethers.parseEther("100"));

    await expect(bridgeB.queueSurplusWithdraw(nixId, owner.address, extra + 1n)).to.be.revertedWithCustomError(
      bridgeB,
      "AmountExceedsSurplus",
    );
    await expect(bridgeB.sweepUntracked(await tokenB.getAddress(), owner.address, extra)).to.be.revertedWithCustomError(
      bridgeB,
      "InvalidToken",
    );

    await bridgeB.queueSurplusWithdraw(nixId, owner.address, extra);
    await expect(bridgeB.executeSurplusWithdraw(nixId)).to.be.revertedWithCustomError(bridgeB, "WithdrawTimelock");
    await mine(Number(await bridgeB.WITHDRAW_DELAY()) + 1);
    const before = await tokenB.balanceOf(owner.address);
    await bridgeB.executeSurplusWithdraw(nixId);
    expect(await tokenB.balanceOf(owner.address)).to.equal(before + extra);
    expect(await bridgeB.accounted(nixId)).to.equal(hre.ethers.parseEther("100"));
    expect(await bridgeB.surplus(nixId)).to.equal(0n);
  });

  it("enforces the outbound bucket, pause, decimals, and one-time registration", async function () {
    const { owner, alice, bob, endpointA, endpointB, bridgeA, bridgeB, tokenA, tokenB, nixId } = await fixture();
    const bucket = hre.ethers.parseEther("5");
    // One automined block advances one second, so this refill cannot restore a full bucket that fast.
    const refill = bucket / 2n;
    await bridgeA.setRateLimit(nixId, EID_B, false, bucket, refill);
    await tokenA.mint(alice.address, bucket);
    await tokenA.connect(alice).approve(await bridgeA.getAddress(), bucket * 3n);

    await bridgeA.connect(alice).send(EID_B, nixId, bucket, bob.address, { value: hre.ethers.parseEther("0.001") });
    await expect(
      bridgeA.connect(alice).send(EID_B, nixId, bucket, bob.address, { value: hre.ethers.parseEther("0.001") }),
    ).to.be.revertedWithCustomError(bridgeA, "RateLimitExceeded");
    await mine(3);
    await bridgeA.connect(alice).send(EID_B, nixId, bucket, bob.address, { value: hre.ethers.parseEther("0.001") });

    await bridgeA.pause();
    await bridgeB.pause();
    await expect(
      bridgeA.connect(alice).send(EID_B, nixId, 1n, bob.address, { value: hre.ethers.parseEther("0.001") }),
    ).to.be.revertedWithCustomError(bridgeA, "EnforcedPause");
    const packet = await packetOf(endpointA);
    await expect(
      endpointB.deliver(await bridgeB.getAddress(), EID_A, await bridgeA.getAddress(), packet.guid, packet.nonce, packet.message),
    ).to.be.revertedWithCustomError(bridgeB, "EnforcedPause");
    await bridgeB.unpause();
    await bridgeA.unpause();

    await bridgeA.setTokenEnabled(nixId, false);
    await expect(
      bridgeA.connect(alice).send(EID_B, nixId, 1n, bob.address, { value: hre.ethers.parseEther("0.001") }),
    ).to.be.revertedWithCustomError(bridgeA, "TokenDisabled");

    const eighteen = await hre.ethers.deployContract("TestERC20", ["Eighteen", "E18", 18]);
    const six = await hre.ethers.deployContract("TestERC20", ["Six", "SIX", 6]);
    const mismatch = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("MISMATCH"));
    await bridgeA.registerToken(mismatch, await eighteen.getAddress());
    await bridgeB.registerToken(mismatch, await six.getAddress());
    await eighteen.mint(alice.address, hre.ethers.parseEther("1"));
    await eighteen.connect(alice).approve(await bridgeA.getAddress(), hre.ethers.parseEther("1"));
    await bridgeA.setRateLimit(mismatch, EID_B, false, bucket, bucket);
    await bridgeA.connect(alice).send(EID_B, mismatch, hre.ethers.parseEther("1"), bob.address, {
      value: hre.ethers.parseEther("0.001"),
    });
    const bad = await packetOf(endpointA);
    await expect(
      endpointB.deliver(await bridgeB.getAddress(), EID_A, await bridgeA.getAddress(), bad.guid, bad.nonce, bad.message),
    ).to.be.revertedWithCustomError(bridgeB, "DecimalMismatch").withArgs(6, 18);

    await expect(bridgeA.connect(alice).registerToken(nixId, await tokenA.getAddress())).to.be.revertedWithCustomError(
      bridgeA,
      "OwnableUnauthorizedAccount",
    );
    await expect(bridgeA.registerToken(nixId, await six.getAddress())).to.be.revertedWithCustomError(
      bridgeA,
      "TokenAlreadyRegistered",
    );
    await bridgeA.setTokenEnabled(nixId, true);
    await expect(bridgeA.send(EID_A, nixId, 1n, bob.address)).to.be.revertedWithCustomError(bridgeA, "InvalidEid");
    await expect(bridgeA.send(EID_B, nixId, 1n, hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      bridgeA,
      "InvalidRecipient",
    );

    const wrong = await hre.ethers.deployContract("MockLayerZeroEndpoint", [EID_A]);
    await expect(
      hre.ethers.deployContract("NixBridge", [await wrong.getAddress(), EID_B, owner.address]),
    ).to.be.revertedWithCustomError(bridgeA, "InvalidEid");
    await expect(hre.ethers.deployContract("NixBridge", [alice.address, EID_A, owner.address])).to.be.revertedWithCustomError(
      bridgeA,
      "InvalidEndpoint",
    );
  });

  it("stops a token callback from releasing the same message twice", async function () {
    const { owner, alice, bob, endpointA, endpointB, bridgeA } = await fixture();
    const source = await hre.ethers.deployContract("TestERC20", ["Attack", "ATK", 18]);
    const attackToken = await hre.ethers.deployContract("ReenteringERC20");
    const attackBridge = await hre.ethers.deployContract("NixBridge", [await endpointB.getAddress(), EID_B, owner.address]);
    const attackId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ATTACK"));
    const amount = hre.ethers.parseEther("4");
    const cap = hre.ethers.parseEther("20");

    await bridgeA.registerToken(attackId, await source.getAddress());
    await attackBridge.registerToken(attackId, await attackToken.getAddress());
    await attackBridge.setPeer(EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32));
    await bridgeA.queuePeer(EID_B, hre.ethers.zeroPadValue(await attackBridge.getAddress(), 32));
    await mine(Number(await bridgeA.PEER_DELAY()) + 1);
    await bridgeA.applyPeer(EID_B);
    await bridgeA.setRateLimit(attackId, EID_B, false, cap, cap);
    await attackBridge.setRateLimit(attackId, EID_A, true, cap, cap);

    await attackToken.mint(owner.address, amount);
    await attackToken.approve(await attackBridge.getAddress(), amount);
    await attackBridge.deposit(attackId, amount);
    await source.mint(alice.address, amount);
    await source.connect(alice).approve(await bridgeA.getAddress(), amount);
    await bridgeA.connect(alice).send(EID_B, attackId, amount, bob.address, { value: hre.ethers.parseEther("0.001") });

    const packet = await packetOf(endpointA);
    const payload = attackBridge.interface.encodeFunctionData("lzReceive", [
      [EID_A, hre.ethers.zeroPadValue(await bridgeA.getAddress(), 32), packet.nonce],
      packet.guid,
      packet.message,
      owner.address,
      "0x",
    ]);
    await attackToken.setAttack(await attackBridge.getAddress(), payload);
    await endpointB.deliver(
      await attackBridge.getAddress(),
      EID_A,
      await bridgeA.getAddress(),
      packet.guid,
      packet.nonce,
      packet.message,
    );

    expect(await attackToken.attacks()).to.equal(1n);
    expect(await attackToken.balanceOf(bob.address)).to.equal(amount);
    expect(await attackBridge.accounted(attackId)).to.equal(0n);
    expect(await attackBridge.executed(packet.guid)).to.equal(true);
  });

  it("moves the endpoint delegate only when the pending owner accepts", async function () {
    const { owner, alice, endpointA, bridgeA } = await fixture();
    expect(await endpointA.delegate()).to.equal(owner.address);
    await bridgeA.transferOwnership(alice.address);
    expect(await bridgeA.owner()).to.equal(owner.address);
    await bridgeA.connect(alice).acceptOwnership();
    expect(await bridgeA.owner()).to.equal(alice.address);
    expect(await endpointA.delegate()).to.equal(alice.address);
  });

  it("uses the same LayerZero endpoint and endpoint ids as the frontend", function () {
    const source = readFileSync("scripts/layerzero.ts", "utf8");
    const frontend = readFileSync("frontend/lib/bridge.ts", "utf8");
    const endpoint = "0x6EDCE65403992e310A62460808c4b910D972f10f";
    const eids = ["40161", "40231", "40245"];
    const chainIds = ["11155111", "421614", "84532"];
    expect(source).to.include(endpoint);
    expect(frontend).to.include(endpoint);
    for (const eid of eids) {
      expect(source).to.include(eid);
      expect(frontend).to.include(eid);
    }
    for (const chainId of chainIds) {
      expect(source).to.include(chainId);
      expect(frontend).to.include(chainId);
    }
  });
});
