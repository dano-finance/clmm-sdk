import { ApiMultiAsset } from "./lpResponse";
import { Value } from "@cardano-ogmios/schema";

export interface MultiAsset {
  policyId: string;
  assets: Asset[];
}

interface Asset {
  name: string;
  value: string;
}

export const buildMultiAssetsFromAssets = (assets: Value): MultiAsset[] => {
  if (!assets || Object.keys(assets).length === 0) {
    return [];
  }

  const multiAssets: ApiMultiAsset[] = [];

  for (const [policyId, assetsMap] of Object.entries(assets)) {
    if (policyId === "ada") continue;

    const currentAssets: Asset[] = [];
    for (const [assetName, quantity] of Object.entries(assetsMap as any)) {
      currentAssets.push({
        name: assetName,
        value: (quantity as any).toString(),
      });
    }

    multiAssets.push({
      policyId,
      assets: currentAssets,
    });
  }

  return multiAssets;
};