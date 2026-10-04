<p align="left">
  <img src="frontend/public/logo.png" alt="NixSwap" width="280" />
</p>

# NixSwap

NixSwap is an omnichain testnet exchange on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. NIX is the quote asset. Swap size and limit stay encrypted until a whitelisted solver fills the order. Pool reserves, prices, and bridge escrow stay public.

The preferred wallet network is Arbitrum Sepolia (chain id 421614). `/` redirects to `/swap`.

## Core features

- **Swap.** The wallet approves `IntentRegistry` and submits an encrypted order. A cloud solver decrypts it and fills `NixPair` when the pool can pay the minimum.
- **Bridge.** NIX locks on the source and releases from escrow on the destination. A launched token burns on the source and mints on the destination. Both paths use LayerZero V2.
- **Launch.** One transaction creates the token and its NIX pair. Of the supply, 94% goes to the creator on the source chain and 2% is seeded with 100 NIX on each of the three chains. Opening LP stays on the launchpad. An optional logo URL is stored with the launch.
- **Pool.** Later deposits call `addLiquidity(nixAmount, tokenAmount)`. The pair pulls both assets at the current reserve ratio. `removeLiquidity(shares)` returns both assets pro rata for shares that wallet owns.
- **Portfolio and markets.** Balances, send, receive, and history are read from the connected wallet. Markets show the public spot, reserves, and window volume for the current launchpad. Token rows show the on-chain logo, or the symbol letter when a launch has none.

The faucet pays the on-chain `FAUCET_DRIP` (500 NIX in the current token source) once per address per day.

## Token logos

The Launch form accepts an optional image link. `https://` and `ipfs://` are allowed, up to 200 bytes. Leave the field blank to launch without a logo.

`createToken(name, symbol, supply, logoURI)` stores the link in `NixLaunchpad.tokenLogo(token)` and emits `TokenLogo`. That storage is permanent and public: every wallet reads the same link from the chain. `relay` appends the link to the LayerZero launch message, and `finalizeRemote` writes it on each peer launchpad. Portfolio, Launch, and Markets then show the image on every network. A missing link, a rejected link, or an image that fails to load keeps the symbol letter. An `ipfs://` link is loaded through `https://ipfs.io/ipfs/`.

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
| NixLaunchpad | [`0x0cc49e80e95AE8e039b206366d40C4C9d1C47cBF`](https://sepolia.arbiscan.io/address/0x0cc49e80e95AE8e039b206366d40C4C9d1C47cBF) | [`0x429D2C11Ab642e24f00153b4b551E04375caE171`](https://sepolia.basescan.org/address/0x429D2C11Ab642e24f00153b4b551E04375caE171) | [`0x8f97B10ca592cB0c9d2F4Cc9c01f03eC826c4744`](https://sepolia.etherscan.io/address/0x8f97B10ca592cB0c9d2F4Cc9c01f03eC826c4744) |
| LaunchFactory | [`0xeaa4421B37ddEC21a02c2D095E6AA6993463903e`](https://sepolia.arbiscan.io/address/0xeaa4421B37ddEC21a02c2D095E6AA6993463903e) | [`0x2ede51F104a89c6d2E71F958b605fca7eaEE0955`](https://sepolia.basescan.org/address/0x2ede51F104a89c6d2E71F958b605fca7eaEE0955) | [`0xBf20dc5054b51bf99eaFc54190C9362dfAB478d5`](https://sepolia.etherscan.io/address/0xBf20dc5054b51bf99eaFc54190C9362dfAB478d5) |
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
