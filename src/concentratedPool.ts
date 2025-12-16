import { ApiMultiAsset } from "./lpResponse";

export interface ConcentratedPool {
  outRef: string;
  address: string;
  coin: string;
  multiAssets: ApiMultiAsset[];
  validityNft: string;
  tokenA: string;
  tokenAReserve: string;
  tokenB: string;
  tokenBReserve: string;
  lpFeeRate: number;
  priceLowerNum: string;
  priceLowerDen: string;
  priceUpperNum: string;
  priceUpperDen: string;
  platformFeeA: string;
  platformFeeB: string;
  minAChange: string;
  minBChange: string;
  lpTokenTotalSupply: string;
  lastWithdrawEpoch: number;
}

export interface DanogoPools {
  liquidityPools: ConcentratedPool[];
  offset: string;
}