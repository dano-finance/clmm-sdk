import axios from "axios";

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

export interface ApiResponse<T = ApiData> {
  code: number;
  traceId: string;
  message: string;
  data: T;
}

export interface ApiData {
  inputs: ApiInputs;
  outputs: ApiOutputs;
  withdrawal: ApiWithdrawal;
  mint: ApiMint;
  referenceInputs: ApiReferenceInput[];
  // auxiliaryData: ApiAuxiliaryData;
  smartContractVersion: string;
}

export interface ApiAsset {
  name: string;
  value: string;
}

export interface ApiMultiAsset {
  policyId: string;
  assets: ApiAsset[];
}

export interface ApiInputs {
  poolInUtxo: ApiUtxo;
}

export interface ApiOutputs {
  poolOutUtxo: ApiUtxo;
}

export interface ApiReferenceInput {
  outRef: string;
  type: string;
}

export interface ApiOraclePrice {
  collateralToken: string;
  priceNum: string;
  priceDen: string;
}

export interface ApiPriceGroup {
  borrowToken: string;
  oraclePrices: ApiOraclePrice[];
}

export interface ApiBorrowRate {
  yieldToken: string;
  borrowRate: string;
}

export interface ApiWithdrawal {
  rewardAddressScriptHash: string;
  coin: string;
  stakeAddress: string | null;
  stakeRewards: string | null;
}

export interface ApiMint {
  multiAssets: (ApiMultiAsset & { redeemerType: string })[];
}

export interface ApiAuxiliaryData {
  loanOwnerNftMetadata: {
    name: string;
    image: string;
    description: string;
  };
}

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

export interface ApiUtxo {
  outRef?: string; // optional in inputs
  address: string;
  coin: string;
  multiAssets: ApiMultiAsset[];
  datum?: PoolDatum;
}
