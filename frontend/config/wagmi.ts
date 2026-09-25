import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import {
  arbitrumSepoliaChain,
  baseSepoliaChain,
  ethereumSepoliaChain,
  transports,
} from "@/config/chains";

// WalletConnect Cloud project id. Injected wallets still connect without it.
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  "00000000000000000000000000000000";

export const config = getDefaultConfig({
  appName: "NixSwap",
  projectId,
  chains: [arbitrumSepoliaChain, baseSepoliaChain, ethereumSepoliaChain],
  transports: {
    [arbitrumSepoliaChain.id]: http(transports[arbitrumSepoliaChain.id]),
    [baseSepoliaChain.id]: http(transports[baseSepoliaChain.id]),
    [ethereumSepoliaChain.id]: http(transports[ethereumSepoliaChain.id]),
  },
  ssr: true,
});
