import { Data } from "@lucid-evolution/lucid";
import { PoolDatum } from "./lpResponse.js";
import { encodeData } from "./encode.js";
import * as cbor from "cbor";

export const transformPoolDatum = (datum: PoolDatum): string => {
  const TokenIdSchema = Data.Tuple([Data.Bytes(), Data.Bytes()]);
  const RationalSchema = Data.Tuple([Data.Integer(), Data.Integer()], {
    hasConstr: true,
  });
  const PoolDatumSchema = Data.Tuple(
    [
      TokenIdSchema, // tokenX
      TokenIdSchema, // tokenY
      Data.Integer(), // lpFeeRate
      Data.Integer(), // platformFeeX
      Data.Integer(), // platformFeeY,
      RationalSchema, // sqrtLowerPrice
      RationalSchema, // sqrtUpperPrice
      Data.Integer(), // minXChange
      Data.Integer(), // minYChange
      Data.Integer(), // circulatingLpToken
      Data.Integer(), // lastWithdrawEpoch
    ],
    { hasConstr: true }
  );

  const tokenX: [string, string] = tokenIdToTuple(datum.tokenX);
  const tokenY: [string, string] = tokenIdToTuple(datum.tokenY);

  const dataArray: [
    [string, string],
    [string, string],
    bigint,
    bigint,
    bigint,
    [bigint, bigint],
    [bigint, bigint],
    bigint,
    bigint,
    bigint,
    bigint,
  ] = [
    tokenX,
    tokenY,
    BigInt(datum.lpFeeRate),
    BigInt(datum.platformFeeX),
    BigInt(datum.platformFeeY),
    [BigInt(datum.sqrtLowerPriceNum), BigInt(datum.sqrtLowerPriceDen)],
    [BigInt(datum.sqrtUpperPriceNum), BigInt(datum.sqrtUpperPriceDen)],
    BigInt(datum.minXChange),
    BigInt(datum.minYChange),
    BigInt(datum.circulatingLPToken),
    BigInt(datum.lastWithdrawEpoch),
  ];

  return encodeData(dataArray, PoolDatumSchema);
};

export const tokenIdToTuple = (tokenId: string): [string, string] => {
  if (!tokenId) return ["", ""];

  try {
    const parts = tokenId.split(".");
    if (parts.length === 2) {
      const policy = parts[0] ?? "";
      const assetName = parts[1] ?? "";

      if (assetName.length > 0) return [policy, assetName];

      return [policy, ""];
    }
    return [tokenId, ""];
  } catch (error) {
    console.error(`Error parsing token ID "${tokenId}":`, error);
    throw new Error(`Failed to parse token ID: ${tokenId}`);
  }
};

export const parseDatum = (datumHex: string): PoolDatum => {
  const decoded = cbor.decodeFirstSync(Buffer.from(datumHex, "hex"));

  // Plutus Data is typically encoded as a Tagged value (Tag 121 for Constr 0)
  // The value inside is an array of fields.
  const fields = decoded instanceof cbor.Tagged ? decoded.value : decoded;

  if (!Array.isArray(fields)) {
    throw new Error("Invalid datum structure: expected array of fields");
  }

  // Helper to parse AssetClass (Constr 0 [PolicyId, AssetName])
  const parseAsset = (field: any): string => {
    const val = field instanceof cbor.Tagged ? field.value : field;
    if (Array.isArray(val) && val.length === 2) {
      const policyId = val[0].toString("hex");
      const assetName = val[1].toString("hex");
      return policyId + assetName;
    }
    throw new Error("Invalid AssetClass structure");
  };

  // Helper to parse Ratio (Constr 0 [Numerator, Denominator])
  const parseRatio = (field: any): { num: string; den: string } => {
    const val = field instanceof cbor.Tagged ? field.value : field;
    if (Array.isArray(val) && val.length === 2) {
      return { num: val[0].toString(), den: val[1].toString() };
    }
    throw new Error("Invalid Ratio structure");
  };

  return {
    tokenX: parseAsset(fields[0]),
    tokenY: parseAsset(fields[1]),
    lpFeeRate: Number(fields[2]),
    platformFeeX: fields[3].toString(),
    platformFeeY: fields[4].toString(),
    sqrtLowerPriceNum: parseRatio(fields[5]).num,
    sqrtLowerPriceDen: parseRatio(fields[5]).den,
    sqrtUpperPriceNum: parseRatio(fields[6]).num,
    sqrtUpperPriceDen: parseRatio(fields[6]).den,
    minXChange: fields[7].toString(),
    minYChange: fields[8].toString(),
    circulatingLPToken: fields[9].toString(),
    lastWithdrawEpoch: Number(fields[10]),
  };
};