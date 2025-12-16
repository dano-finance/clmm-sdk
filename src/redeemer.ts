import { RedeemerBuilder, UTxO } from "@lucid-evolution/lucid";

/**
 * Converts a BigInt to a big-endian byte array (Uint8Array) of a specific length.
 * @param n The BigInt to convert.
 * @param length The desired length of the output byte array.
 * @returns A Uint8Array representing the BigInt, padded with leading zeros if necessary.
 */
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

export const swapTokensRedeemer = (poolInUtxos: UTxO[], deltaAmounts: bigint[]) => {
  try {
    // currently, only support one pool in -> one pool out
    const redeemer: RedeemerBuilder = {
      kind: "selected",
      inputs: poolInUtxos,

      makeRedeemer: (inputIdxs: bigint[]) => {
        const SWAP_ACTION = 3n
        // Convert each number to a byte array of a specific, padded length
        const poolInBytes = bigintToBytesPadded(inputIdxs[0], 1);
        const actionBytes = bigintToBytesPadded(SWAP_ACTION, 1);
        const poolOutBytes = bigintToBytesPadded(0n, 1); // has only one pool out, already make sure put pool out is the first element
        const amountBytes = bigintToBytesPadded(deltaAmounts[0], 32); // swap 1 pool -> 1 deltaAmount

        // Create a new Uint8Array to hold the concatenated bytes
        const totalLength = poolInBytes.length + actionBytes.length + poolInBytes.length + poolOutBytes.length + amountBytes.length;
        const concatenatedBytes = new Uint8Array(totalLength);

        // Copy the bytes from each part into the final array
        let pos = 0;
        concatenatedBytes.set(poolInBytes, pos);
        pos += poolInBytes.length;
        concatenatedBytes.set(actionBytes, pos);
        pos += actionBytes.length;
        concatenatedBytes.set(poolInBytes, pos);
        pos += poolInBytes.length;
        concatenatedBytes.set(poolOutBytes, pos);
        pos += poolOutBytes.length;
        concatenatedBytes.set(amountBytes, pos);
        // Convert the Uint8Array to a hex string, which Data.to expects for bytestrings.
        const redeemerAsHex = Buffer.from(concatenatedBytes).toString("hex");
        return "5824" + redeemerAsHex; // 5824 specify for 36 bytes of redeemer
      },
    };
    return redeemer;
  } catch (error) {
    console.error("Error creating pool redeemer:", error);
    throw error;
  }
};
