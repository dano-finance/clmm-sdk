# Danogo Swap SDK

An SDK to calculate and execute swaps on the Danogo liquidity platform on the Cardano network.

## Installation

```bash
npm install danogo-clmm-sdk
```

## Usage

### Prerequisites

This SDK relies on `@lucid-evolution/lucid` for wallet management and transaction building.

### Initialization

Initialize the SDK with the Danogo API URL. Optionally, you can provide a custom pool script hash.

```typescript
import DanogoSwap from "danogo-clmm-sdk";

const sdk = new DanogoSwap();
```

### 1. Calculate Swap Output (Quote)

Calculate the expected output of a swap without submitting a transaction. This is useful for UI previews or checking rates.

```typescript
import DanogoSwap from "danogo-clmm-sdk";
import { Lucid, Kupmios } from "@lucid-evolution/lucid";

const sdk = new DanogoSwap();

async function main() {
  const lucid = await Lucid(
    new Kupmios("kupo_url", "ogmios_url"),
    "Preprod"
  );

  const quoteRequest = {
    poolOutRef: {
      txHash:
        "your_tx_hash",
      outputIndex: 0, // your output index
    },
    stakingOutRef: {
      txHash:
        "your_tx_hash",
      outputIndex: 1, // your output index
    },
    deltaAmount: -3000000n,
  };

  try {
    const expectedOutput = await sdk.calculateSwapOut(lucid, quoteRequest);
    console.log(`Expected output amount: ${expectedOutput}`);
  } catch (error) {
    console.error("Calculation failed", error);
  }
}
```

### 2. Submit Swap Transaction

Build and submit a swap transaction using a Lucid instance.

```typescript
import DanogoSwap from "danogo-clmm-sdk";
import { Lucid, Kupmios } from "@lucid-evolution/lucid";

const sdk = new DanogoSwap();

async function main() {
  // 1. Initialize Lucid with your provider (recommend Kupmios)
  const lucid = await Lucid(
    new Kupmios("kupo_url", "ogmios_url"),
    "Preprod"
  );
  
  // 2. Select wallet
  lucid.selectWallet.fromSeed("your seed phrase");

  const swapRequest = {
    poolOutRef: {
      txHash:
        "your_tx_hash",
      outputIndex: 0, // your pool output index
    },
    poolScriptOutRef: {
      txHash:
        "your_tx_hash",
      outputIndex: 0, // your pool script output index
    },
    stakingOutRef: {
      txHash:
        "your_tx_hash",
      outputIndex: 1, // your staking output index
    },
    deltaAmount: -3000000n, // Positive: User sells X -> Buy Y, Negative: User sells Y -> Buy X
    minOutChangeAmount: 10000n, // Minimum amount of token received to accept
  }

  try {
    const txHash = await sdk.submitSwap(lucid, swapRequest);
    console.log(`Transaction submitted: ${txHash}`);
  } catch (error) {
    console.error("Swap failed", error);
  }
}
```

Note for Kupmios Users: There is currently a known issue with lucid-evolution when using Kupmios for transaction evaluation. If you encounter errors during submission, you may need to manually patch node_modules/@lucid-evolution/provider/dist/index.js node_modules/@lucid-evolution/provider/dist/index.cjs by commenting out the additionalUtxo line in the evaluateTx method: 
```javascript
 const data = {
      jsonrpc: "2.0",
      method: "evaluateTransaction",
      params: {
        transaction: { cbor: tx },
        // additionalUtxo: toOgmiosUTxOs(additionalUTxOs)  // comment here
      },
      id: null
    };
 ```


 ### 3. Get Pool Info from Ogmios Transaction

Extract pool data directly from an Ogmios transaction object.

```typescript
import DanogoSwap from "danogo-clmm-sdk";
import { createInteractionContext, createChainSynchronizationClient } from "@cardano-ogmios/client";

const sdk = new DanogoSwap();

async function main() {
  const context = await createInteractionContext(
    console.error,
    () => console.log("closed"),
    {
      // example with demeter
      connection: {
        host: "ogmios1xxxxxxxxxxxx.cardano-preprod-v6.ogmios-m1.dmtr.host",
        port: 443,
        tls: true
      },
    }
  );

  const client = await createChainSynchronizationClient(context, {
    rollForward: async ({ block }, requestNext) => {
      if ("transactions" in block) {
        for (const tx of block.transactions!) {
          const pools = sdk.getPoolsFromOgmiosTx(tx);
          // your logic here
        }
      }

      requestNext();
    },

    rollBackward: async ({ point }, requestNext) => {
      // ...
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