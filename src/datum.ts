import { Data, CBOR } from "@evolution-sdk/evolution";
import { InlineDatum } from "@evolution-sdk/evolution/InlineDatum";
import { ADA_UNIT } from "./constants";

export interface PoolDatum {
  tokenX: string;
  tokenY: string;
  sqrtLowerPriceNum: bigint;
  sqrtLowerPriceDen: bigint;
  sqrtUpperPriceNum: bigint;
  sqrtUpperPriceDen: bigint;
  lpFeeRate: number;
  platformFeeX: bigint;
  platformFeeY: bigint;
  totalSwapFee: bigint;
  minXChange: bigint;
  minYChange: bigint;
  circulatingLPToken: bigint;
  lastWithdrawEpoch: number;
}

export interface ProtocolConfigDatum {
  platformFeeRate: bigint,
  swapFee: bigint
}

/** @internal */
export const transformPoolDatum = (datum: PoolDatum): InlineDatum => {
  // Create arrays for tokenX and tokenY
  const tokenXData = [
    new Uint8Array(Buffer.from(datum.tokenX.slice(0, 56), 'hex')),
    new Uint8Array(Buffer.from(datum.tokenX.slice(57), 'hex')), // ignore dot separator
  ];

  // Create arrays for tokenY
  const tokenYData = [
    new Uint8Array(Buffer.from(datum.tokenY.slice(0, 56), 'hex')),
    new Uint8Array(Buffer.from(datum.tokenY.slice(57), 'hex')), // ignore dot separator
  ];

  // Create PlutusData for sqrtLowerPrice ratio
  const sqrtLowerPriceData = Data.constr(0n, [
    datum.sqrtLowerPriceNum,
    datum.sqrtLowerPriceDen,
  ]);

  // Create PlutusData for sqrtUpperPrice ratio
  const sqrtUpperPriceData = Data.constr(0n, [
    datum.sqrtUpperPriceNum,
    datum.sqrtUpperPriceDen,
  ]);

  // Create the main pool datum as a Constr with all fields
  const poolDataumData = Data.constr(0n, [
    tokenXData,
    tokenYData,
    BigInt(datum.lpFeeRate),
    datum.platformFeeX,
    datum.platformFeeY,
    datum.totalSwapFee,
    sqrtLowerPriceData,
    sqrtUpperPriceData,
    datum.minXChange,
    datum.minYChange,
    datum.circulatingLPToken,
    BigInt(datum.lastWithdrawEpoch),
  ]);

  return new InlineDatum({ data: poolDataumData });
};

/** @internal */
export const transformProtocolConfigDatum = (datum: ProtocolConfigDatum): InlineDatum => {
  const protocolConfigData = Data.constr(0n, [
    BigInt(datum.platformFeeRate),
    BigInt(datum.swapFee),
  ]);

  const hex = Data.toCBORHex(protocolConfigData);
  return new InlineDatum({ data: hex as any });
};

/** @internal */
export const tokenIdToTuple = (tokenId: string): [string, string] => {
  if (!tokenId) return ["", ""];

  try {
    if (tokenId.includes(".")) {
      const parts = tokenId.split(".");
      if (parts.length === 2) {
        return [parts[0], parts[1]];
      }
      return [tokenId, ""];
    }

    const policy = tokenId.slice(0, 56);
    const assetName = tokenId.slice(56);
    return [policy, assetName];
  } catch (error) {
    console.error(`Error parsing token ID "${tokenId}":`, error);
    throw new Error(`Failed to parse token ID: ${tokenId}`);
  }
};

/** @internal */
export const parseDatum = (datumHex: string | InlineDatum): PoolDatum => {
  let decoded: any;

  if (typeof datumHex === "string") {
    decoded = CBOR.fromCBORHex(datumHex);
  } else {
    // InlineDatum stores Data, not a hex string
    const inlineData = datumHex.data;
    const inlineHex = Data.toCBORHex(inlineData);
    decoded = CBOR.fromCBORHex(inlineHex);
  }

  // Plutus Data is typically encoded as a Tagged value (Tag 121 for Constr 0)
  // The value inside is an array of fields.
  const fields = (decoded as any)._tag === "Tag" ? (decoded as any).value : decoded;

  if (!Array.isArray(fields)) {
    throw new Error("Invalid datum structure: expected array of fields");
  }

  // Helper to parse AssetClass (Constr 0 [PolicyId, AssetName])
  const parseAsset = (field: any): string => {
    const val = (field as any)._tag === "Tag" ? (field as any).value : field;
    if (Array.isArray(val) && val.length === 2) {
      const policyId = val[0] instanceof Uint8Array ? val[0] : new Uint8Array(val[0]);
      const assetName = val[1] instanceof Uint8Array ? val[1] : new Uint8Array(val[1]);
      const policyIdHex = Buffer.from(policyId).toString("hex");
      const assetNameHex = Buffer.from(assetName).toString("hex");
      if (policyIdHex === "" && assetNameHex === "") {
        return ADA_UNIT;
      }
      return policyIdHex + "." + assetNameHex;
    }
    throw new Error("Invalid AssetClass structure");
  };

  // Helper to parse Ratio (Constr 0 [Numerator, Denominator])
  const parseRatio = (field: any): { num: bigint; den: bigint } => {
    const val = (field as any)._tag === "Tag" ? (field as any).value : field;
    if (Array.isArray(val) && val.length === 2) {
      return { num: BigInt(val[0]), den: BigInt(val[1]) };
    }
    throw new Error("Invalid Ratio structure");
  };

  return {
    tokenX: parseAsset(fields[0]),
    tokenY: parseAsset(fields[1]),
    lpFeeRate: Number(fields[2]),
    platformFeeX: BigInt(fields[3]),
    platformFeeY: BigInt(fields[4]),
    totalSwapFee: BigInt(fields[5]),
    sqrtLowerPriceNum: parseRatio(fields[6]).num,
    sqrtLowerPriceDen: parseRatio(fields[6]).den,
    sqrtUpperPriceNum: parseRatio(fields[7]).num,
    sqrtUpperPriceDen: parseRatio(fields[7]).den,
    minXChange: BigInt(fields[8]),
    minYChange: BigInt(fields[9]),
    circulatingLPToken: BigInt(fields[10]),
    lastWithdrawEpoch: Number(fields[11]),
  };
};

/** @internal */
export const parseProtocolConfigDatum = (datumHex: InlineDatum): ProtocolConfigDatum => {
  let decoded: any;

  const inlineHex = Data.toCBORHex(datumHex.data);
  decoded = CBOR.fromCBORHex(inlineHex);

  // Plutus Data is typically encoded as a Tagged value (Tag 121 for Constr 0)
  // The value inside is an array of fields.
  const fields = (decoded as any)._tag === "Tag" ? (decoded as any).value : decoded;

  if (!Array.isArray(fields)) {
    throw new Error("Invalid datum structure: expected array of fields");
  }

  return {
    platformFeeRate: BigInt(fields[0]),
    swapFee: BigInt(fields[1]),
  };
};