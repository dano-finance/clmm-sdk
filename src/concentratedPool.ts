import { TransactionInput } from "@evolution-sdk/evolution";
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
    poolOutRef: TransactionInput.TransactionInput;
    deltaAmount: bigint;
    minOutChangeAmount: bigint;
    stakingOutRef?: TransactionInput.TransactionInput;
  }[];
  protocolConfigOutRef?: TransactionInput.TransactionInput;
}


export interface QuoteSwapRequest {
  pools: {
    poolOutRef: TransactionInput.TransactionInput;
    deltaAmount: bigint;
    stakingOutRef?: TransactionInput.TransactionInput;
  }[];
  protocolConfigOutRef?: TransactionInput.TransactionInput;
}