import { Data, UTxO } from "@evolution-sdk/evolution";
import type { IndexedInput } from "@evolution-sdk/evolution/sdk/builders/RedeemerBuilder";
import { RedeemerArg } from "@evolution-sdk/evolution/sdk/builders/RedeemerBuilder";

/**
 * Converts a BigInt to a big-endian byte array (Uint8Array) of a specific length.
 * @param n The BigInt to convert.
 * @param length The desired length of the output byte array.
 * @returns A Uint8Array representing the BigInt, padded with leading zeros if necessary.
 */
/** @internal */
export function bigintToBytesPadded(n: bigint, length: number): Uint8Array {
  // if n is negative, n only can be deltaAmount
  // add 2^256 (32 bytes) to get positive number represent deltaAmount
  const unSignNum = n >= 0n ? n : n + (1n << 256n);

  let hex = unSignNum.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  
  const numBytes = hex.length / 2;
  if (numBytes > length) {
    throw new Error(
      `Number ${n} requires ${numBytes} bytes, but target length is ${length}.`
    );
  }

  const u8 = new Uint8Array(length);
  const offset = length - numBytes;
  for (let i = 0; i < numBytes; i++) {
    u8[i + offset] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return u8;
}

/** @internal */
export const swapTokensRedeemer = (
  poolInUtxos: UTxO.UTxO[],
  deltaAmounts: bigint[],
  protocolConfigIdx: bigint,
  isWithdrawZero: boolean,
): RedeemerArg => {
  try {
    // currently only supports one pool in -> one pool out
    const buildRedeemerData = (inputIndex: bigint): Data.Data => {
      const SWAP_ACTION = 3n;
      const firstBytes = bigintToBytesPadded(
        isWithdrawZero ? protocolConfigIdx : inputIndex,
        1,
      );
      const poolInBytes = bigintToBytesPadded(inputIndex, 1);
      const actionBytes = bigintToBytesPadded(SWAP_ACTION, 1);
      const poolOutBytes = bigintToBytesPadded(0n, 1); // only one pool out
      const amountBytes = bigintToBytesPadded(deltaAmounts[0], 32); // swap 1 pool -> 1 deltaAmount

      const totalLength =
        firstBytes.length +
        actionBytes.length +
        poolInBytes.length +
        poolOutBytes.length +
        amountBytes.length;
      const concatenatedBytes = new Uint8Array(totalLength);

      let pos = 0;
      concatenatedBytes.set(firstBytes, pos);
      pos += firstBytes.length;
      concatenatedBytes.set(actionBytes, pos);
      pos += actionBytes.length;
      concatenatedBytes.set(poolInBytes, pos);
      pos += poolInBytes.length;
      concatenatedBytes.set(poolOutBytes, pos);
      pos += poolOutBytes.length;
      concatenatedBytes.set(amountBytes, pos);

      const redeemerAsHex = Buffer.from(concatenatedBytes).toString("hex");
      // 5824 is CBOR byte string prefix for 36 bytes.
      return Data.fromCBORHex("5824" + redeemerAsHex);
    };

    return {
      all: (indexedInputs: ReadonlyArray<IndexedInput>) => {
        if (!indexedInputs.length) {
          throw new Error("swapTokensRedeemer batch all called with empty indexedInputs");
        }

        const inputIndex = BigInt(indexedInputs[0].index);
        return buildRedeemerData(inputIndex);
      },
      inputs: poolInUtxos,
    };
  } catch (error) {
    console.error("Error creating pool redeemer:", error);
    throw error;
  }
};
