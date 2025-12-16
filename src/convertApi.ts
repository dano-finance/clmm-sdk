import { Assets, OutRef, UTxO } from "@lucid-evolution/lucid";
import { ApiMultiAsset, ApiReferenceInput, ApiUtxo } from "./lpResponse.js";

// Helper functions to parse API response
export const apiToAssets = (
  multiAssets: ApiMultiAsset[] | undefined,
  coin: string
): Assets => {
  const assets: Assets = { lovelace: BigInt(coin) };
  if (!multiAssets) return assets;

  for (const ma of multiAssets) {
    for (const asset of ma.assets) {
      const unit = ma.policyId + (asset.name || "");
      assets[unit] = BigInt(asset.value);
    }
  }
  return assets;
};

export const apiToUtxo = (apiUtxo: ApiUtxo | null): UTxO => {
  if (apiUtxo == null || apiUtxo == undefined || !apiUtxo?.outRef) {
    throw new Error("apiToUtxo: outRef is missing");
  }

  const [txHash, outputIndex] = apiUtxo.outRef.split("#");
  if (txHash === undefined || outputIndex === undefined) {
    throw new Error("apiToUtxo: Invalid outRef format");
  }

  return {
    txHash,
    outputIndex: parseInt(outputIndex),
    address: apiUtxo.address,
    assets: apiToAssets(apiUtxo.multiAssets, apiUtxo.coin),
  };
};

export const apiToRefUtxo = (apiRef: ApiReferenceInput): OutRef => {
  const [txHash, outputIndex] = apiRef.outRef.split("#");
  if (txHash === undefined || outputIndex === undefined) {
    throw new Error("apiToRefUtxo: Invalid outRef format");
  }
  return { txHash, outputIndex: parseInt(outputIndex) };
};