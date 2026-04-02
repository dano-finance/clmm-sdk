# Danogo Swap SDK

An SDK to calculate and execute swaps on the Danogo liquidity platform on the Cardano network.

## Installation

```bash
npm install danogo-clmm
```

## Prerequisites

This SDK requires:
- Node.js 18+
- `@evolution-sdk/evolution` for wallet management and transaction building
- A Kupmios provider for blockchain data
- An Ogmios instance for transaction submission

### ⚠️ TypeScript Compatibility Note

The dependency `@evolution-sdk/evolution` currently ships with some TypeScript type definitions that may cause compilation errors in strict projects.

If you encounter type errors originating from `node_modules/@evolution-sdk/evolution`, you can safely enable the following option in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Usage

### Initialization

Initialize the SDK.
```typescript
import DanogoSwap from "danogo-clmm";

const sdk = new DanogoSwap();
```

### 1. Calculate Swap Output (Quote)

Calculate the expected output of a swap without submitting a transaction. This is useful for UI previews or checking rates.

```typescript
import DanogoSwap from "danogo-clmm";
import { createClient } from "@evolution-sdk/evolution";

const sdk = new DanogoSwap();

async function main() {
  const client = createClient({
    network: "preprod", // your network
    provider: {
      type: "kupmios", // recommend kupmios
      kupoUrl: "your_kupo_url",
      ogmiosUrl: "your_ogmios_url",
    },
    wallet: {
      type: "seed",
      mnemonic: "your seed phrase",
      accountIndex: 0, // your accountIndex
    },
  });

  const quoteRequest: QuoteSwapRequest = {
    poolOutRef: new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 0n,
    }),
    deltaAmount: -3_000_000n, // Positive: User sells X -> Buy Y, Negative: User sells Y -> Buy X
    protocolConfigOutRef: new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 0n,
    }),
    stakingOutRef: new TransactionInput.TransactionInput({ // if pool contains ADA
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 1n,
    }),
  };

  try {
    const expectedOutput = await sdk.calculateSwapOut(client, quoteRequest);
    console.log(`Expected output amount: ${expectedOutput}`);
  } catch (error) {
    console.error("Calculation failed", error);
  }
}
```

### 2. Submit Swap Transaction

Build and submit a swap transaction using an Evolution client.

```typescript
import DanogoSwap from "danogo-clmm";
import { createClient, TransactionInput, TransactionHash } from "@evolution-sdk/evolution";

const sdk = new DanogoSwap();

async function main() {
  // 1. Initialize client with your provider
  const client = createClient({
    network: "preprod", // your network
    provider: {
      type: "kupmios", // recommend kupmios
      kupoUrl: "your_kupo_url",
      ogmiosUrl: "your_ogmios_url",
    },
    wallet: {
      type: "seed",
      mnemonic: "your seed phrase",
      accountIndex: 0, // your accountIndex
    },
  });

  const swapRequest: SwapRequest = {
    poolOutRef: new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 0n,
    }),
    deltaAmount: -3_000_000n, // Positive: User sells X -> Buy Y, Negative: User sells Y -> Buy X
    minOutChangeAmount: 10000n, // Minimum amount of token received to accept
    poolScriptOutRef: new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 0n,
    }),
    protocolConfigOutRef: new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 0n,
    }),
    stakingOutRef: new TransactionInput.TransactionInput({ // if pool contains ADA
      transactionId: TransactionHash.fromHex("your_tx_hash"),
      index: 1n,
    }),
  };

  try {
    const txHash = await sdk.submitSwap(client, swapRequest);
    console.log(`Transaction submitted: ${txHash}`);
  } catch (error) {
    console.error("Swap failed", error);
  }
}
```

### 3. Get Pool Info from Ogmios Transaction

Extract pool data directly from an Ogmios transaction object.

```typescript
import DanogoSwap from "danogo-clmm";
import { createChainSynchronizationClient, createInteractionContext } from "@cardano-ogmios/client";
import { Point } from "@cardano-ogmios/schema";

const sdk = new DanogoSwap();

async function main() {
  const context = await createInteractionContext(
    console.error,
    () => console.log("closed"),
    {
      connection: {
        host: "your_ogmios_host",
        port: 443,
        tls: true
      },
    }
  );

  const client = await createChainSynchronizationClient(context, {
    rollForward: async ({ block }, requestNext) => {
      if ("transactions" in block) {
        for (const tx of block.transactions!) {
          const pools = sdk.getPoolsFromOgmiosTx(tx, "your_pool_script_hash");
          // your logic with pools
        }
      }
      requestNext();
    },

    rollBackward: async ({ point }, requestNext) => {
      // handle rollbacks
      requestNext();
    },
  });

  const checkpoint: Point = {
    slot: 109847210, // Replace with your slot
    id: "your_block_hash",
  };

  await client.resume([checkpoint]);
}
```