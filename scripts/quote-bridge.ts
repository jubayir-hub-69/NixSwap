import { zeroPadValue } from "ethers";
import hre from "hardhat";
import { LAYERZERO_TESTNET_ENDPOINT, layerZeroChain } from "./layerzero";

const ARBITRUM_NIX = "0xfE128bCc8F4D45AB9E24bF446EEa8302d1FD4CB7";

async function main() {
  const local = layerZeroChain(421614);
  const remote = layerZeroChain(84532);
  await hre.network.provider.send("hardhat_reset", [
    {
      forking: {
        jsonRpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL ?? local.rpcDefault,
      },
    },
  ]);

  const [owner] = await hre.ethers.getSigners();
  if (!owner) throw new Error("No signer on the forked network.");
  const bridge = await hre.ethers.deployContract("NixBridge", [LAYERZERO_TESTNET_ENDPOINT, local.eid, owner.address]);
  const nixId = await bridge.NIX_TOKEN_ID();
  await bridge.registerToken(nixId, ARBITRUM_NIX);
  await bridge.setPeer(remote.eid, zeroPadValue(owner.address, 32));
  await bridge.setRateLimit(nixId, remote.eid, false, hre.ethers.parseEther("10"), 1n);
  const fee = await bridge.quoteSend(remote.eid, nixId, hre.ethers.parseEther("1"), owner.address);
  if (fee <= 0n) throw new Error("LayerZero quote returned a zero fee.");
  console.log(`Arbitrum Sepolia quote to Base Sepolia: ${hre.ethers.formatEther(fee)} ETH`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
