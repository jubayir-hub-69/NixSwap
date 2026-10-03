<p align="left">
  <img src="frontend/public/logo.png" alt="NixSwap" width="280" />
</p>

# NixSwap

NixSwap is an omnichain testnet exchange on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. NIX is the quote asset. Swap size and limit stay encrypted until a whitelisted solver fills the order. Pool reserves, prices, and bridge escrow stay public.

The preferred wallet network is Arbitrum Sepolia (chain id 421614). `/` redirects to `/swap`.

## Core features

- **Swap.** The wallet approves `IntentRegistry` and submits an encrypted order. A cloud solver decrypts it and fills `NixPair` when the pool can pay the minimum.
- **Bridge.** NIX locks on the source and releases from escrow on the destination. A launched token burns on the source and mints on the destination. Both paths use LayerZero V2.
- **Launch.** One transaction creates the token and its NIX pair. Of the supply, 94% goes to the creator on the source chain and 2% is seeded with 100 NIX on each of the three chains. Opening LP stays on the launchpad.
- **Pool.** Later deposits call `addLiquidity(nixAmount, tokenAmount)`. The pair pulls both assets at the current reserve ratio. `removeLiquidity(shares)` returns both assets pro rata for shares that wallet owns.
- **Portfolio and markets.** Balances, send, receive, and history are read from the connected wallet. Markets show the public spot, reserves, and window volume for the current launchpad.

The faucet pays the on-chain `FAUCET_DRIP` (500 NIX in the current token source) once per address per day.

## Architecture

The Next.js app talks to the three testnet RPCs through wagmi. CoFHE encrypts a swap in the browser. `IntentRegistry` stores the order. The solver fills `NixPair`. `NixLaunchpad` creates each token through `LaunchFactory`. `NixBridge` and `LaunchToken` send LayerZero messages to the shared testnet endpoint `0x6EDCE65403992e310A62460808c4b910D972f10f`.

| Layer | Stack |
| --- | --- |
| Interface | Next.js 16, React 19, Tailwind CSS 4, RainbowKit |
| Contracts | Solidity 0.8.28, Hardhat, OpenZeppelin, Fhenix CoFHE |
| Messaging | LayerZero V2 |
| Solver | Node.js service polling `frontend/config/deployments.json` |

`NixPair` and `LaunchToken` are deployed per launch. Read them from `NixLaunchpad.allTokens`. Product behavior and call shapes are documented in the app at `/docs`.

## Contract addresses

Addresses below are the deployments the app reads. The canonical file is `frontend/config/deployments.json`. An address can appear on more than one chain because of deployer nonce. Use the row for the chain you are calling.

| Contract | Arbitrum Sepolia (421614) | Base Sepolia (84532) | Ethereum Sepolia (11155111) |
| --- | --- | --- | --- |
| NixToken | [`0xfE128bCc8F4D45AB9E24bF446EEa8302d1FD4CB7`](https://sepolia.arbiscan.io/address/0xfE128bCc8F4D45AB9E24bF446EEa8302d1FD4CB7) | [`0x3FfcBFb90DBc92994643415838d4177cf2b64b78`](https://sepolia.basescan.org/address/0x3FfcBFb90DBc92994643415838d4177cf2b64b78) | [`0xb0575745DDd4c43D70F9d8a890aF52bE047b408b`](https://sepolia.etherscan.io/address/0xb0575745DDd4c43D70F9d8a890aF52bE047b408b) |
| IntentRegistry | [`0x838491A2108457b7F895C70548061776F97995D7`](https://sepolia.arbiscan.io/address/0x838491A2108457b7F895C70548061776F97995D7) | [`0x444CC59294421CAf78cc40fb92691b3657F0cAE6`](https://sepolia.basescan.org/address/0x444CC59294421CAf78cc40fb92691b3657F0cAE6) | [`0xBbc7C81C07C9E75960aDAb5F6Ee94e639C24832b`](https://sepolia.etherscan.io/address/0xBbc7C81C07C9E75960aDAb5F6Ee94e639C24832b) |
| NixLaunchpad | [`0x86798f4777A48a3aA6cd2B1bee0E5BF7C85806eb`](https://sepolia.arbiscan.io/address/0x86798f4777A48a3aA6cd2B1bee0E5BF7C85806eb) | [`0x540a746AD6b3C87666b2B1Bcd6Cc0ee5ce235d43`](https://sepolia.basescan.org/address/0x540a746AD6b3C87666b2B1Bcd6Cc0ee5ce235d43) | [`0x2De65f74667E8B38B331302f4e341834c769DCfa`](https://sepolia.etherscan.io/address/0x2De65f74667E8B38B331302f4e341834c769DCfa) |
| LaunchFactory | [`0x429D2C11Ab642e24f00153b4b551E04375caE171`](https://sepolia.arbiscan.io/address/0x429D2C11Ab642e24f00153b4b551E04375caE171) | [`0xaCdbE5De1AFc601a01B9026233B57702150E38b8`](https://sepolia.basescan.org/address/0xaCdbE5De1AFc601a01B9026233B57702150E38b8) | [`0x540a746AD6b3C87666b2B1Bcd6Cc0ee5ce235d43`](https://sepolia.etherscan.io/address/0x540a746AD6b3C87666b2B1Bcd6Cc0ee5ce235d43) |
| NixBridge | [`0x6B34A7ADf191a058FaaC8377716657B5d849AA95`](https://sepolia.arbiscan.io/address/0x6B34A7ADf191a058FaaC8377716657B5d849AA95) | [`0x98e4cA0060D15dddE86e123E2e8Dc7ba35A46333`](https://sepolia.basescan.org/address/0x98e4cA0060D15dddE86e123E2e8Dc7ba35A46333) | [`0x1F484EbdbCB1C6e6320ab73F7A579ceb79eF6eE2`](https://sepolia.etherscan.io/address/0x1F484EbdbCB1C6e6320ab73F7A579ceb79eF6eE2) |

## Run the app

Use Node.js 20 or newer.

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Contract tests run from the repository root with `npm test`.

## License

ISC.
