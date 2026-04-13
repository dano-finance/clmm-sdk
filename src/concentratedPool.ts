import { MultiAsset } from "./multiAssets.js";

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
  totalSwapFee: bigint;
}


export interface SwapRequest {
  pools: {
    poolOutRef: string;
    deltaAmount: bigint;
    minOutChangeAmount?: bigint;
    stakingOutRef?: string;
  }[];
  protocolConfigOutRef?: string;
}


export interface QuoteSwapRequest {
  pools: {
    poolOutRef: string;
    deltaAmount: bigint;
    stakingOutRef?: string;
  }[];
  protocolConfigOutRef?: string;
}