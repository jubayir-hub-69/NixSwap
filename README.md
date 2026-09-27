# NixSwap

Next-generation confidential DEX and universal launchpad powered by Fhenix CoFHE.

NixSwap lets a trader encrypt order size and limit price, while pool reserves, spot prices, and the token list stay public. The same app launches fixed-supply tokens, shows live market stats, and drips testnet NIX from an owner-funded faucet.

## Architecture

NixSwap splits confidential dealing from public market data.

Fhenix CoFHE keeps selected values encrypted on-chain. The browser encrypts an order with `@cofhe/sdk` (`encryptInputs` for an `euint64` amount, an `euint32` target chain, and an `euint64` limit, plus one batch proof). `IntentRegistry.submitSwapIntent` stores those ciphertexts and grants decrypt access only to a whitelisted solver, and only inside the intent window. Token addresses are public, because the market needs to know which pair is being traded. The approval that precedes a swap is an unlimited allowance, so the approval event does not publish the order size.

Public market data lives in ordinary contract storage:

- `NixPair` keeps NIX and token reserves, a spot price, a daily price mark, and NIX volume for the current window.
- `NixLaunchpad` stores every launched token: name, symbol, supply, creator, and pair.
- `NixPool` is the single-asset NIX vault. Deposits are public. Each provider's share balance is an encrypted `euint64`.

`NixToken` is a dual-mode token. It is a normal ERC-20 for allowances, the faucet, and pool deposits, and it can shield those tokens into a confidential balance. Only the holder, after an on-chain ACL grant, can decrypt that balance in the app.

## Core features

### Shielded swaps

The Swap and Trade screens encrypt the amount and the limit with `fhenixClient.encrypt()`, then call `IntentRegistry`. The solver must already be whitelisted. The deployment script whitelists the deployer. Before the encrypted transaction, the UI reads the real ERC-20 `allowance`. If it is below the amount, the button is **Approve Token**. After that transaction confirms, the button becomes **Swap** or **Trade**.

### Confidential pools

Anyone can add liquidity to a launched token's NIX pair. Reserves and the spot price are public, which is what the Markets page prices from. The depositor approves NIX and the launched token for the exact amounts the pair will pull, then calls `addLiquidity`. The core NIX vault (`NixPool`) still tracks each provider's shares as ciphertext.

### Universal launchpad

`NixLaunchpad.createToken` deploys a fixed-supply ERC-20 and a `NixPair` against NIX. A wallet may have one active launch. `retire` frees that slot. The token and its pool stay in the public list either way. Supply per launch is capped at 1 trillion tokens.

### Live market analytics

The Markets page reads every launch and its pair:

- spot price and both reserves
- 24h NIX volume, measured as NIX added to the pool during the current on-chain window
- top gainers, top losers, and trending tokens

The 24h change is the move since the pair's daily price mark. Until that mark rolls, the figure is the change since launch or since the last reserve update. These numbers come from the pair. They are not hardcoded quotes.

### NIX tokenomics and faucet

| Rule | Value |
| --- | --- |
| Initial supply | 1,000,000,000 NIX, minted to the deployer |
| Further supply | Owner-only `mint(address to, uint256 amount)` |
| Supply reduction | Owner-only `burn(uint256 amount)` burns from the owner balance |
| Faucet | `claimFaucet()` sends 500 NIX from the owner |
| Faucet limit | One claim per address per day, and at most 100,000,000 NIX in total drips |

The Navbar button reads `FAUCET_DRIP` from the deployed token and shows that amount. On the current build it is **500 NIX**.

## Contract deployments

Deployer on every network: `0x9AFe5CeF11fC10756faef213f7A30D9873B5d372`.

`NixPair` and `LaunchToken` are created per launch. They do not have a single address.

Ethereum Sepolia is the deployment that includes `NixLaunchpad`. That deployment still uses the previous token (10,000 NIX drip and a 1 billion mint cap). Base Sepolia and Arbitrum Sepolia still have the earlier contracts. The supply check on Base returned 0 before the mint receipt was visible, and the Arbitrum deployment reverted. Redeploy both L2s with the commands at the bottom to publish the launchpad, the 1 billion mint, owner `burn`, and the 500 NIX faucet. Redeploy Ethereum Sepolia as well if that network should pick up the same tokenomics.

### Ethereum Sepolia (11155111)

| Contract | Address |
| --- | --- |
| NixToken | [`0xD3504e2118b1c7a52cf44947510633562635ee03`](https://sepolia.etherscan.io/address/0xD3504e2118b1c7a52cf44947510633562635ee03) |
| IntentRegistry | [`0x3FfcBFb90DBc92994643415838d4177cf2b64b78`](https://sepolia.etherscan.io/address/0x3FfcBFb90DBc92994643415838d4177cf2b64b78) |
| NixPool | [`0xC8F58962dfb5032aE50BEF5bEFf2e1a7886960BA`](https://sepolia.etherscan.io/address/0xC8F58962dfb5032aE50BEF5bEFf2e1a7886960BA) |
| NixLaunch | [`0x6da5bd7D6Ef534C387b26Df59930e8F6d36C8d59`](https://sepolia.etherscan.io/address/0x6da5bd7D6Ef534C387b26Df59930e8F6d36C8d59) |
| NixLaunchpad | [`0xDd2BfD7A8D5E29dCcBc37f69F520A74Bd9d461b1`](https://sepolia.etherscan.io/address/0xDd2BfD7A8D5E29dCcBc37f69F520A74Bd9d461b1) |

### Base Sepolia (84532)

Last confirmed deployment. `NixLaunchpad` is not on this network yet.

| Contract | Address |
| --- | --- |
| NixToken | [`0xE3FdB021493953C95F4c93bCCF83B762e4475Ed7`](https://sepolia.basescan.org/address/0xE3FdB021493953C95F4c93bCCF83B762e4475Ed7) |
| IntentRegistry | [`0x609A9D897DB4c554a03d4304c8EF42b56ea32e31`](https://sepolia.basescan.org/address/0x609A9D897DB4c554a03d4304c8EF42b56ea32e31) |
| NixPool | [`0xb30c9272a28749Ae0B04E1d5977337a570025009`](https://sepolia.basescan.org/address/0xb30c9272a28749Ae0B04E1d5977337a570025009) |
| NixLaunch | [`0x045700Cd0D442E65dcB549330580d9981bcbC5E0`](https://sepolia.basescan.org/address/0x045700Cd0D442E65dcB549330580d9981bcbC5E0) |

### Arbitrum Sepolia (421614)

Last confirmed deployment. `NixLaunchpad` is not on this network yet.

| Contract | Address |
| --- | --- |
| NixToken | [`0x6da5bd7D6Ef534C387b26Df59930e8F6d36C8d59`](https://sepolia.arbiscan.io/address/0x6da5bd7D6Ef534C387b26Df59930e8F6d36C8d59) |
| IntentRegistry | [`0xDd2BfD7A8D5E29dCcBc37f69F520A74Bd9d461b1`](https://sepolia.arbiscan.io/address/0xDd2BfD7A8D5E29dCcBc37f69F520A74Bd9d461b1) |
| NixPool | [`0xb0575745DDd4c43D70F9d8a890aF52bE047b408b`](https://sepolia.arbiscan.io/address/0xb0575745DDd4c43D70F9d8a890aF52bE047b408b) |
| NixLaunch | [`0x8cf2152c960BE67e0654bd3Bc702be30728501a4`](https://sepolia.arbiscan.io/address/0x8cf2152c960BE67e0654bd3Bc702be30728501a4) |

Addresses are also stored in `frontend/config/deployments.json`. A successful `npm run deploy` rewrites that file and `frontend/config/contracts.ts`.

## Tech stack

| Layer | Stack |
| --- | --- |
| Contracts | Solidity 0.8.28, Hardhat 2, OpenZeppelin 5, Fhenix CoFHE |
| Encryption | `@cofhe/sdk` in the browser and in Hardhat tests |
| Frontend | Next.js 16.3.6, React 19, TypeScript, Tailwind CSS 4 |
| Wallet | wagmi 2, viem 2, RainbowKit |
| Networks | Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia |

The frontend dev server and production build use webpack. Turbopack deadlocks while tracing `@cofhe/sdk`, so `npm run dev` and `npm run build` pass `--webpack`.

## Local setup

Install the contract toolchain from the repository root, then the frontend:

```bash
npm install
npm test
```

Create a root `.env` before any public deploy. Do not commit it.

```bash
PRIVATE_KEY=0x...
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Optional RPC variables fall back to the public endpoints above. `LAUNCH_BIDDING_SECONDS` overrides the sealed-launch window. The default is 7 days.

Start the app:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). WalletConnect needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in `frontend/.env.local`. Injected wallets such as MetaMask still connect when that variable is unset.

Useful scripts from the root:

```bash
npm test
npm run deploy -- --network "Ethereum Sepolia"
npx hardhat run scripts/syncAbi.ts
```

`scripts/syncAbi.ts` rewrites the frontend ABIs from the compiled artifacts and leaves the saved addresses in place.

## Redeploy Base Sepolia and Arbitrum Sepolia

From the repository root, with `PRIVATE_KEY` set in `.env` and the deployer funded on both networks:

```bash
npm run deploy -- --network "Base Sepolia"
npm run deploy -- --network "Arbitrum Sepolia"
```

On those two networks the script waits for two confirmations (`tx.wait(2)`) before it reads `totalSupply`, retries that read against the mint's block, and refuses to continue if the code at the receipt address is empty. It also waits until the deployer's latest and pending nonces match, then sends every transaction with an explicit nonce. If L2 gas estimation reverts, it sends the deployment with a 30,000,000 gas limit instead of aborting on the estimate. Each successful run replaces that network's record in `frontend/config/contracts.ts`.
