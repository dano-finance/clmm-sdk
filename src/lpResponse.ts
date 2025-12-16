import axios from "axios";

/** @internal */
export async function getSwapParameters(
  poolId: string,
  deltaAmount: string,
  apiUrl: string,
): Promise<ApiData> {
  const apiRequestBody = {
    poolId,
    deltaAmount,
  };

  const response = await axios.post(
    apiUrl,
    apiRequestBody
  );
  return (response.data as ApiResponse).data;
}

/** @internal */
export interface ApiResponse<T = ApiData> {
  code: number;
  traceId: string;
  message: string;
  data: T;
}

/** @internal */
export interface ApiData {
  inputs: ApiInputs;
  outputs: ApiOutputs;
  withdrawal: ApiWithdrawal;
  mint: ApiMint;
  referenceInputs: ApiReferenceInput[];
  // auxiliaryData: ApiAuxiliaryData;
  smartContractVersion: string;
}

/** @internal */
export interface ApiAsset {
  name: string;
  value: string;
}

export interface ApiMultiAsset {
  policyId: string;
  assets: ApiAsset[];
}

/** @internal */
export interface ApiInputs {
  poolInUtxo: ApiUtxo;
}

/** @internal */
export interface ApiOutputs {
  poolOutUtxo: ApiUtxo;
}

/** @internal */
export interface ApiReferenceInput {
  outRef: string;
  type: string;
}

/** @internal */
export interface ApiOraclePrice {
  collateralToken: string;
  priceNum: string;
  priceDen: string;
}

/** @internal */
export interface ApiPriceGroup {
  borrowToken: string;
  oraclePrices: ApiOraclePrice[];
}

/** @internal */
export interface ApiBorrowRate {
  yieldToken: string;
  borrowRate: string;
}

/** @internal */
export interface ApiWithdrawal {
  rewardAddressScriptHash: string;
  coin: string;
  stakeAddress: string | null;
  stakeRewards: string | null;
}

/** @internal */
export interface ApiMint {
  multiAssets: (ApiMultiAsset & { redeemerType: string })[];
}

/** @internal */
export interface ApiAuxiliaryData {
  loanOwnerNftMetadata: {
    name: string;
    image: string;
    description: string;
  };
}

/** @internal */
export interface PoolDatum {
  tokenX: string;
  tokenY: string;
  sqrtLowerPriceNum: string;
  sqrtLowerPriceDen: string;
  sqrtUpperPriceNum: string;
  sqrtUpperPriceDen: string;
  lpFeeRate: number;
  platformFeeX: string;
  platformFeeY: string;
  minXChange: string;
  minYChange: string;
  circulatingLPToken: string;
  lastWithdrawEpoch: number;
}

/** @internal */
export interface ApiUtxo {
  outRef?: string; // optional in inputs
  address: string;
  coin: string;
  multiAssets: ApiMultiAsset[];
  datum?: PoolDatum;
}
