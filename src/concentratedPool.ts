import { OutRef } from "@lucid-evolution/lucid";
import { MultiAsset } from "./multiAssets";

export interface ConcentratedPool {
  outRef: string;
  address: string;
  coin: bigint;
  multiAssets: MultiAsset[];
  validityNft: string;
  tokenA: string;
  tokenAReserve: bigint;
  tokenB: string;
  tokenBReserve: bigint;
  lpFeeRate: number;
  priceLowerNum: bigint;
  priceLowerDen: bigint;
  priceUpperNum: bigint;
  priceUpperDen: bigint;
  platformFeeA: bigint;
  platformFeeB: bigint;
  minAChange: bigint;
  minBChange: bigint;
  lpTokenTotalSupply: bigint;
  lastWithdrawEpoch: number;
}

export interface SwapRequest {
  poolOutRef: OutRef;
  poolScriptOutRef: OutRef;
  deltaAmount: bigint;
  minOutChangeAmount: bigint;
  stakingOutRef?: OutRef;
}

export interface QuoteSwapRequest {
  poolOutRef: OutRef;
  deltaAmount: bigint;
  stakingOutRef?: OutRef;
}