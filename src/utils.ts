import { Network, OutRef, UTxO } from "@lucid-evolution/lucid";
import { PoolDatum } from "./datum.js";

/** @internal */
export const getEpoch = (t: number, network: Network): number => {
  let epochLength = 432000000;
  const epochBoundary = 1647899091000;
  const epochBoundaryAsEpoch = 328;
  if (network !== "Mainnet") {
    epochLength = 1800000;
  }

  return Math.floor((t - epochBoundary) / epochLength) + epochBoundaryAsEpoch;
};

/** @internal */
export function calculateConcentratedPoolSwap(
  tokenAAmount: bigint,
  tokenBAmount: bigint,
  datum: PoolDatum,
  deltaAmount: bigint,
  rewardAmount: bigint = 0n,
  platformFeeRate: bigint
): [bigint, bigint] {
  // Constants
  const poolInAmount = deltaAmount < 0n ? -deltaAmount : deltaAmount;
  const excludedADA: bigint = datum.tokenX === "" ? 3_000_000n + BigInt(datum.totalSwapFee) : 0n;
  const activeReserveX =
    BigInt(tokenAAmount) - BigInt(datum.platformFeeX) + rewardAmount - excludedADA;
  const activeReserveY = BigInt(tokenBAmount) - BigInt(datum.platformFeeY);

  const liquidity = calcLiquidity(
    activeReserveX,
    activeReserveY,
    [BigInt(datum.sqrtLowerPriceNum), BigInt(datum.sqrtLowerPriceDen)],
    [BigInt(datum.sqrtUpperPriceNum), BigInt(datum.sqrtUpperPriceDen)]
  );
  const xV =
    ceilDiv(
      liquidity[0] * BigInt(datum.sqrtUpperPriceDen),
      liquidity[1] * BigInt(datum.sqrtUpperPriceNum)
    ) + activeReserveX;
  const yV =
    ceilDiv(
      liquidity[0] * BigInt(datum.sqrtLowerPriceNum),
      liquidity[1] * BigInt(datum.sqrtLowerPriceDen)
    ) + activeReserveY;
  if (deltaAmount > 0n)
    return getPoolChange(
      poolInAmount,
      xV,
      yV,
      activeReserveY,
      BigInt(datum.lpFeeRate),
      platformFeeRate
    );
  return getPoolChange(
    poolInAmount,
    yV,
    xV,
    activeReserveX,
    BigInt(datum.lpFeeRate),
    platformFeeRate
  );
}

/** @internal */
const getPoolChange = (
  amountIn: bigint,
  tokenInVirtual: bigint,
  tokenOutVirtual: bigint,
  tokenOutReal: bigint,
  lpFeeRate: bigint,
  platformFeeRate: bigint
): [bigint, bigint] => {
  const BASE = 10_000n;

  // fee calculations
  const lpFee = (amountIn * lpFeeRate) / BASE;
  const platformFee = (lpFee * BigInt(platformFeeRate)) / 10_000n;
  const offFee = BASE - lpFeeRate;

  // main math
  const denominator = tokenInVirtual * BASE + amountIn * offFee;
  const virtualProduct = tokenInVirtual * tokenOutVirtual;

  const numerator = tokenOutVirtual * denominator - virtualProduct * BASE;
  const expectedOut = numerator / denominator;

  // safety check
  if (expectedOut > tokenOutReal) {
    throw new Error("pool out exceeded");
  }

  // return tuple: [expectedTokenOut, fee]
  return [expectedOut, platformFee];
};

/** @internal */
const calcLiquidity = (
  x: bigint,
  y: bigint,
  pa: [bigint, bigint],
  pb: [bigint, bigint]
): [bigint, bigint] => {
  const denAdenB = pa[1] * pb[1];
  const numAnumB = pa[0] * pb[0];

  const diffSquare =
    (y * denAdenB - x * numAnumB) * (y * denAdenB - x * numAnumB);
  const xy4Term = 4n * x * y * pa[1] * pa[1] * pb[0] * pb[0];
  const bigSqrtInNumerator = sqrtBigInt(diffSquare + xy4Term);
  const numerator = y * denAdenB + x * numAnumB + bigSqrtInNumerator;
  const denominator = 2n * (pb[0] * pa[1] - pb[1] * pa[0]);
  return [numerator, denominator];
};

function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error("Square root of negative number");
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");

  const q = a / b;
  const r = a % b;

  // If a and b have the same sign and remainder is non-zero, add 1n
  return r === 0n || a < 0n !== b < 0n ? q : q + 1n;
}

export function getPoolProtocolConfigIdx(protocolOutRef: OutRef, refInputs: UTxO[]): bigint {
  const sortedInputs = [...refInputs].sort((a, b) => {
    if (a.txHash === b.txHash) return a.outputIndex - b.outputIndex;
    return a.txHash < b.txHash ? -1 : 1;
  });
  const idx = sortedInputs.findIndex(
    (input) => input.txHash === protocolOutRef.txHash && input.outputIndex === protocolOutRef.outputIndex
  );
  if (idx === -1) {
    throw new Error("Protocol config out ref not found in reference inputs");
  }
  return BigInt(idx);
}
