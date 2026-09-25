import { expect } from "chai";
import hre from "hardhat";
import { CofheClient, Encryptable, FheTypes } from "@cofhe/sdk";

describe("NixToken", function () {
  const ONE = hre.ethers.parseUnits("1", 18);
  const RATE = 10n ** 12n;

  async function deploy() {
    const [owner, alice, bob] = await hre.ethers.getSigners();
    const token = await hre.ethers.deployContract("NixToken", ["Nix Token", "NIX", owner.address]);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    return { token, owner, alice, bob, aliceClient, bobClient };
  }

  async function encryptUnits(client: CofheClient, tokenAddress: string, units: bigint) {
    const [handle, proof] = await client
      .encryptInputs([Encryptable.uint64(units)])
      .setConsumingContract(tokenAddress)
      .execute();
    return { handle, proof };
  }

  it("shields public tokens into an encrypted balance and transfers that balance privately", async function () {
    const { token, owner, alice, bob, aliceClient, bobClient } = await deploy();
    await token.connect(owner).mint(alice.address, 1_000n * ONE);

    await token.connect(alice).shield(500n * ONE);

    expect(await token.balanceOf(alice.address)).to.equal(500n * ONE);
    expect(await token.balanceOf(await token.CONFIDENTIAL_POOL())).to.equal(500n * ONE);

    const aliceHandle = await token.confidentialBalanceOf(alice.address);
    expect(aliceHandle).to.not.equal(hre.ethers.ZeroHash);

    const encrypted = await encryptUnits(aliceClient, await token.getAddress(), 100n * 10n ** 6n);
    const tx = await token.connect(alice).getFunction("confidentialTransfer(address,bytes32,bytes)")(
      bob.address,
      encrypted.handle,
      encrypted.proof
    );
    await tx.wait();

    const bobHandle = await token.confidentialBalanceOf(bob.address);
    expect(bobHandle).to.not.equal(hre.ethers.ZeroHash);
    expect(await token.balanceOf(bob.address)).to.equal(0n);

    const aliceDecrypted = await aliceClient
      .decryptForView(await token.confidentialBalanceOf(alice.address), FheTypes.Uint64)
      .execute();
    const bobDecrypted = await bobClient.decryptForView(bobHandle, FheTypes.Uint64).execute();
    expect(aliceDecrypted).to.equal(400n * 10n ** 6n);
    expect(bobDecrypted).to.equal(100n * 10n ** 6n);

    const receipt = await tx.wait();
    const plaintextAmount = (100n * 10n ** 6n).toString();
    expect(JSON.stringify(receipt?.logs ?? [])).to.not.include(plaintextAmount);
    expect(await token.confidentialTotalSupply()).to.equal((500n * ONE) / RATE);
  });

  it("unshields an encrypted amount and claims the public tokens back", async function () {
    const { token, owner, alice, aliceClient } = await deploy();
    await token.connect(owner).mint(alice.address, 100n * ONE);
    await token.connect(alice).shield(100n * ONE);

    const units = 40n * 10n ** 6n;
    const encrypted = await encryptUnits(aliceClient, await token.getAddress(), units);
    await token.connect(alice).getFunction("unshield(bytes32,bytes)")(encrypted.handle, encrypted.proof);

    const [claim] = await token.getUserClaims(alice.address);
    expect(claim.decryptedAmount).to.equal(0n);

    const revealed = await aliceClient.decryptForTx(claim.ctHash).withoutACP().execute();
    await token.claimUnshielded(claim.claimId, revealed.decryptedValue, revealed.signature);

    expect(await token.balanceOf(alice.address)).to.equal(40n * ONE);
    expect(await token.balanceOf(await token.CONFIDENTIAL_POOL())).to.equal(60n * ONE);
    expect(await token.getUserClaims(alice.address)).to.deep.equal([]);
  });

  it("lets a holder sign a balance-view permit without revealing the amount", async function () {
    const { token, owner, alice, bob, bobClient } = await deploy();
    await token.connect(owner).mint(alice.address, 25n * ONE);
    await token.connect(alice).shield(25n * ONE);

    const balanceHandle = await token.confidentialBalanceOf(alice.address);
    const nonce = await token.nonces(alice.address);
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp + 3600);
    const signature = await alice.signTypedData(
      {
        name: "Nix Token",
        version: "1",
        chainId: (await hre.ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress(),
      },
      {
        BalanceViewPermit: [
          { name: "holder", type: "address" },
          { name: "viewer", type: "address" },
          { name: "balanceHandle", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { holder: alice.address, viewer: bob.address, balanceHandle, nonce, deadline }
    );
    const { v, r, s } = hre.ethers.Signature.from(signature);

    await token.permitBalanceView(alice.address, bob.address, balanceHandle, deadline, v, r, s);

    const decrypted = await bobClient.decryptForView(balanceHandle, FheTypes.Uint64).execute();
    expect(decrypted).to.equal(25n * 10n ** 6n);
    expect(JSON.stringify({ balanceHandle, nonce: nonce.toString(), deadline: deadline.toString() })).to.not.include(
      (25n * 10n ** 6n).toString()
    );
  });

  it("rejects a direct transfer into the confidential pool", async function () {
    const { token, owner, alice } = await deploy();
    await token.connect(owner).mint(alice.address, ONE);
    await expect(token.connect(alice).transfer(await token.CONFIDENTIAL_POOL(), ONE)).to.be.revertedWithCustomError(
      token,
      "PoolIsNotDirectlyTransferable"
    );
  });
});
