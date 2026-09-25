"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { CofheClient, EncryptStep } from "@cofhe/sdk";

type ConnectArgs = Parameters<CofheClient["connect"]>;

const UINT64_MAX = (1n << 64n) - 1n;

export type ShieldedIntent = {
  encryptedAmount: `0x${string}`;
  encryptedTargetChain: `0x${string}`;
  encryptedLimit: `0x${string}`;
  inputProof: `0x${string}`;
};

export type EncryptedValue = {
  hash: `0x${string}`;
  inputProof: `0x${string}`;
};

export type EncryptedPair = {
  first: `0x${string}`;
  second: `0x${string}`;
  inputProof: `0x${string}`;
};

const stepLabel: Record<EncryptStep, string> = {
  initTfhe: "Starting encryption",
  fetchKeys: "Fetching FHE keys",
  pack: "Packing the amount",
  prove: "Building the proof",
  verify: "Verifying with CoFHE",
};

let clientPromise: Promise<CofheClient> | undefined;

async function getFhenixClient(): Promise<CofheClient> {
  if (typeof window === "undefined") {
    throw new Error("The Fhenix client is only available in the browser.");
  }

  clientPromise ??= (async () => {
    const { createCofheClient, createCofheConfig } = await import("@cofhe/sdk/web");
    const { arbSepolia, baseSepolia, sepolia } = await import("@cofhe/sdk/chains");
    return createCofheClient(
      createCofheConfig({
        supportedChains: [sepolia, arbSepolia, baseSepolia],
      }),
    );
  })();

  return clientPromise;
}

function asHex(value: string): `0x${string}` {
  if (!value.startsWith("0x") || value.length !== 66) {
    throw new Error("CoFHE returned a handle that is not bytes32.");
  }
  return value as `0x${string}`;
}

function asProof(value: string): `0x${string}` {
  if (!value.startsWith("0x")) {
    throw new Error("CoFHE returned a proof that is not hex.");
  }
  return value as `0x${string}`;
}

function assertUint64(value: bigint, label: string) {
  if (value <= 0n || value > UINT64_MAX) {
    throw new Error(`${label} must fit in an encrypted uint64.`);
  }
}

type StepHandler = (label: string) => void;

async function runEncrypt<T extends readonly string[]>(
  client: CofheClient,
  items: Parameters<CofheClient["encryptInputs"]>[0],
  consumingContract: Address,
  onStep?: StepHandler,
): Promise<T> {
  const encrypted = await client
    .encryptInputs(items)
    .setConsumingContract(consumingContract)
    .onStep((step, context) => {
      if (context?.isStart) onStep?.(stepLabel[step]);
    })
    .execute();
  return encrypted as unknown as T;
}

type FhenixClient = {
  encrypt: (
    amount: bigint,
    targetChain: number,
    limit: bigint,
    consumingContract: Address,
    onStep?: StepHandler,
  ) => Promise<ShieldedIntent>;
  encryptUint64: (
    value: bigint,
    consumingContract: Address,
    onStep?: StepHandler,
  ) => Promise<EncryptedValue>;
  encryptUint64Pair: (
    first: bigint,
    second: bigint,
    consumingContract: Address,
    onStep?: StepHandler,
  ) => Promise<EncryptedPair>;
};

export function useFhenix() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [step, setStep] = useState<string | null>(null);

  const connection = useQuery({
    queryKey: ["fhenix-connection", address, chainId],
    enabled: Boolean(address && publicClient && walletClient),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !walletClient) {
        throw new Error("Wallet client is not ready.");
      }
      const client = await getFhenixClient();
      await client.connect(
        publicClient as unknown as ConnectArgs[0],
        walletClient as unknown as ConnectArgs[1],
      );
      return true;
    },
  });

  const withClient = useCallback(
    async <T,>(work: (client: CofheClient, report: StepHandler) => Promise<T>) => {
      if (!publicClient || !walletClient) {
        throw new Error("Connect a wallet before encrypting.");
      }
      const client = await getFhenixClient();
      await client.connect(
        publicClient as unknown as ConnectArgs[0],
        walletClient as unknown as ConnectArgs[1],
      );
      try {
        setStep("Starting encryption");
        return await work(client, setStep);
      } finally {
        setStep(null);
      }
    },
    [publicClient, walletClient],
  );

  const encrypt = useCallback(
    async (
      amount: bigint,
      targetChain: number,
      limit: bigint,
      consumingContract: Address,
      onStep?: StepHandler,
    ) => {
      assertUint64(amount, "Amount");
      assertUint64(limit, "Limit");
      if (targetChain <= 0 || targetChain > 0xffffffff) {
        throw new Error("Target chain does not fit in an encrypted uint32.");
      }
      return withClient(async (client, report) => {
        const { Encryptable } = await import("@cofhe/sdk");
        const [encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof] =
          await runEncrypt<[`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`]>(
            client,
            [
              Encryptable.uint64(amount),
              Encryptable.uint32(BigInt(targetChain)),
              Encryptable.uint64(limit),
            ],
            consumingContract,
            (label) => {
              report(label);
              onStep?.(label);
            },
          );
        return {
          encryptedAmount: asHex(encryptedAmount),
          encryptedTargetChain: asHex(encryptedTargetChain),
          encryptedLimit: asHex(encryptedLimit),
          inputProof: asProof(inputProof),
        };
      });
    },
    [withClient],
  );

  const encryptUint64 = useCallback(
    async (value: bigint, consumingContract: Address, onStep?: StepHandler) => {
      assertUint64(value, "Amount");
      return withClient(async (client, report) => {
        const { Encryptable } = await import("@cofhe/sdk");
        const [hash, inputProof] = await runEncrypt<[`0x${string}`, `0x${string}`]>(
          client,
          [Encryptable.uint64(value)],
          consumingContract,
          (label) => {
            report(label);
            onStep?.(label);
          },
        );
        return { hash: asHex(hash), inputProof: asProof(inputProof) };
      });
    },
    [withClient],
  );

  const encryptUint64Pair = useCallback(
    async (first: bigint, second: bigint, consumingContract: Address, onStep?: StepHandler) => {
      assertUint64(first, "Amount");
      assertUint64(second, "Limit");
      return withClient(async (client, report) => {
        const { Encryptable } = await import("@cofhe/sdk");
        const [left, right, inputProof] = await runEncrypt<
          [`0x${string}`, `0x${string}`, `0x${string}`]
        >(
          client,
          [Encryptable.uint64(first), Encryptable.uint64(second)],
          consumingContract,
          (label) => {
            report(label);
            onStep?.(label);
          },
        );
        return {
          first: asHex(left),
          second: asHex(right),
          inputProof: asProof(inputProof),
        };
      });
    },
    [withClient],
  );

  const fhenixClient = useMemo<FhenixClient>(
    () => ({ encrypt, encryptUint64, encryptUint64Pair }),
    [encrypt, encryptUint64, encryptUint64Pair],
  );

  return {
    fhenixClient,
    ready: connection.data === true,
    connecting: connection.isFetching,
    connectError: connection.error instanceof Error ? connection.error.message : null,
    step,
    address,
    chainId,
    isConnected,
  };
}
