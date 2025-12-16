import {
  LucidEvolution,
  TxBuilder,
  UTxO,
  Assets,
  credentialToRewardAddress,
} from "@lucid-evolution/lucid";
import {
  getSwapParameters,
  ApiResponse,
  ApiUtxo,
  PoolDatum,
} from "./lpResponse.js";
import {
  Transaction,
} from "@cardano-ogmios/schema";
import { apiToAssets, apiToRefUtxo, apiToUtxo } from "./convertApi.js";
import { swapTokensRedeemer } from "./redeemer.js";
import { parseDatum, transformPoolDatum } from "./datum.js";
import { buildMultiAssetsFromAssets, MultiAsset } from "./multiAssets.js";
import { ConcentratedPool, DanogoPools } from "./concentratedPool.js";
import axios from "axios";

class DanogoSwap {
  constructor(
    public apiPublicUrl: string,
    public poolScriptHash: string = "273a576a5de694ff507765c57b47efdc81ea7f13a43dc4441644fab0"
  ) {}

  /**
   * Calculates the expected output amount for a swap in a given liquidity pool.
   *
   * This function communicates with the backend API to get swap parameters but does not
   * submit a transaction. It's a read-only operation to preview a swap's result.
   *
   * @param poolId The ID of the liquidity pool.
   * @param deltaAmount The amount of the input token to swap.
   *                    - A positive string (e.g., "1000000") indicates User sells Token X to receive Token Y.
   *                    - A negative string (e.g., "-1000000") indicates User sells Token Y to receive Token X.
   * @returns A promise that resolves to a `bigint` representing the amount of the output token you will receive.
   */
  async calculateSwapOut(poolId: string, deltaAmount: string): Promise<bigint> {
    try {
      const { inputs, outputs } = await getSwapParameters(
        poolId,
        deltaAmount,
        this.apiPublicUrl
      );

      const poolInUtxo = inputs.poolInUtxo;
      const poolOutUtxo = outputs.poolOutUtxo;

      // This logic is adapted from the compare-swap tool
      const assetsIn = apiToAssets(poolInUtxo.multiAssets, poolInUtxo.coin);
      const assetsOut = apiToAssets(poolOutUtxo.multiAssets, poolOutUtxo.coin);

      const tokenXUnit =
        poolOutUtxo.datum!.tokenX.replace(".", "") || "lovelace";
      const tokenYUnit =
        poolOutUtxo.datum!.tokenY.replace(".", "") || "lovelace";

      const assetsToCompare = [
        { unit: tokenXUnit, name: "Token X" },
        { unit: tokenYUnit, name: "Token Y" },
      ];

      let tokenXChange = 0n;
      let tokenYChange = 0n;

      for (const token of assetsToCompare) {
        const val1 = assetsIn[token.unit] || 0n;
        const val2 = assetsOut[token.unit] || 0n;
        if (val1 !== val2) {
          const diff = val2 - val1; // diff > 0 means pool gained tokens
          if (token.name === "Token X") {
            tokenXChange = diff;
          } else {
            tokenYChange = diff;
          }
        }
      }

      // If the pool's balance of Token Y decreased, that's the amount paid out.
      if (tokenYChange < 0n) {
        return -tokenYChange;
      }
      // If the pool's balance of Token X decreased, that's the amount paid out.
      if (tokenXChange < 0n) {
        return -tokenXChange;
      }

      return 0n; // Should not happen in a valid swap
    } catch (error) {
      console.error("Failed to calculate swap output:", error);
      throw new Error("Could not calculate the swap output amount.");
    }
  }

  /**
   * Builds and submits a swap transaction to the network.
   *
   * @param lucid An initialized Lucid instance with a connected wallet.
   * @param poolId The ID of the liquidity pool.
   * @param deltaAmount The amount to swap (positive for User sells X -> Y, negative for User sells Y -> X).
   * @returns A promise that resolves to the transaction hash.
   */
  async submitSwap(
    lucid: LucidEvolution,
    poolId: string,
    deltaAmount: string,
    minOutChangeAmount: string
  ): Promise<string> {
    const {
      inputs: apiInputs,
      outputs: apiOutputs,
      referenceInputs: apiRefInputs,
      withdrawal: apiWithdrawal,
    } = await getSwapParameters(poolId, deltaAmount, this.apiPublicUrl);

    if (!lucid || !lucid.wallet()) {
      throw new Error("Please connect a wallet first.");
    }

    const tokenX = apiOutputs.poolOutUtxo.datum!.tokenX;
    const tokenY = apiOutputs.poolOutUtxo.datum!.tokenY;
    const deltaAmountBigInt = BigInt(deltaAmount);
    const tokenIn = deltaAmountBigInt > 0n ? tokenX : tokenY;
    const tokenOut = deltaAmountBigInt > 0n ? tokenY : tokenX;

    // Initialize the transaction builder
    let tx: TxBuilder = lucid.newTx();

    // 1. Check user wallet has enough tokenIn
    const userUtxos = await lucid.wallet().getUtxos();
    const tokenInId = tokenIn.replace(".", "") || "lovelace";
    const totalTokenInBalance = userUtxos.reduce(
      (acc, utxo) => acc + (utxo.assets[tokenInId] || 0n),
      0n
    );
    const requiredAmount =
      deltaAmountBigInt < 0n ? -deltaAmountBigInt : deltaAmountBigInt;
    if (totalTokenInBalance < requiredAmount) {
      throw new Error(
        `Insufficient ${tokenInId} balance. Required: ${requiredAmount}, Available: ${totalTokenInBalance}`
      );
    }

    // 2. Collect Inputs from API
    const poolInUtxos: UTxO[] = [apiToUtxo(apiInputs.poolInUtxo)];
    if (!poolInUtxos.length) throw new Error("Could not find pool input UTxO.");

    // 3. Add Reference Inputs
    const refUtxos = apiRefInputs.map(apiToRefUtxo);
    const refUtxosOnChain: UTxO[] = await lucid.utxosByOutRef(refUtxos);
    tx = tx.readFrom(refUtxosOnChain);

    // 4. Add Outputs
    const poolOutUtxo = apiOutputs.poolOutUtxo;
    const assets: Assets = apiToAssets(
      poolOutUtxo.multiAssets,
      poolOutUtxo.coin
    );
    const tokenOutId = tokenOut.replace(".", "") || "lovelace";
    const poolInAssets = apiToAssets(
      apiInputs.poolInUtxo.multiAssets,
      apiInputs.poolInUtxo.coin
    );
    const actualOutput = poolInAssets[tokenOutId] - assets[tokenOutId];
    if (actualOutput < BigInt(minOutChangeAmount)) {
      throw new Error(
        `Slippage too high. Minimum expected output: ${minOutChangeAmount}, Actual output: ${actualOutput}`
      );
    }

    const transformedDatum = transformPoolDatum(poolOutUtxo.datum!);
    tx = tx.pay.ToAddressWithData(
      poolOutUtxo.address,
      {
        kind: "inline",
        value: transformedDatum,
      },
      assets
    );

    // 5. Add Metadata
    tx = tx.attachMetadata(674, {
      msg: ["Danogo Liquidity Pair: Swap"],
    });

    // 6. Add spend & withdrawal
    const rewardScriptHash = apiWithdrawal.rewardAddressScriptHash;
    const rewardAddress = credentialToRewardAddress(lucid.config().network!, {
      type: "Script",
      hash: rewardScriptHash,
    });

    tx = tx
      .collectFrom(
        poolInUtxos,
        swapTokensRedeemer(poolInUtxos, [deltaAmountBigInt])
      )
      .withdraw(
        rewardAddress,
        0n,
        swapTokensRedeemer(poolInUtxos, [deltaAmountBigInt])
      );

    if (tokenX === "" && apiWithdrawal.stakeRewards) {
      tx = tx.withdraw(
        apiWithdrawal.stakeAddress!,
        BigInt(apiWithdrawal.stakeRewards),
        swapTokensRedeemer(poolInUtxos, [deltaAmountBigInt])
      );
    }

    // 7. Finalize and Submit
    tx = tx
      .validFrom(Date.now() - 120000)
      .validTo(Date.now() + 240000)
      .setMinFee(17000n)
      .addSigner(await lucid.wallet().address());

    const builtTx = await tx.complete({
      localUPLCEval: false,
    });
    console.log({ builtTx: builtTx.toCBOR() });
    const signedTx = await builtTx.sign.withWallet().complete();
    return await signedTx.submit();
  }

  /**
   * Fetches a list of liquidity pools from the API and converts them into ApiUtxo objects.
   *
   * @param limit The maximum number of pools to retrieve.
   * @param offset The pagination offset (cursor) for fetching the next batch of pools.
   * @param tokenA (Optional) Filter pools containing this token ID (policyId + hexName).
   * @param tokenB (Optional) Filter pools containing this token ID (policyId + hexName).
   * @returns A promise that resolves to an array of `ApiUtxo` objects representing the liquidity pools.
   */
  async getLiquidityPools(
    limit: number,
    offset: string,
    tokenA?: string,
    tokenB?: string
  ): Promise<ApiUtxo[]> {
    try {
      const response = await axios.get<ApiResponse<DanogoPools>>(
        `${this.apiPublicUrl}/api/v1/concentrated/pools`,
        {
          params: {
            limit,
            offset,
            tokenA,
            tokenB,
          },
        }
      );
      return response.data.data.liquidityPools.map((pool: ConcentratedPool) => {
        const datum: PoolDatum = {
          tokenX: pool.tokenA,
          tokenY: pool.tokenB,
          sqrtLowerPriceNum: pool.priceLowerNum,
          sqrtLowerPriceDen: pool.priceLowerDen,
          sqrtUpperPriceNum: pool.priceUpperNum,
          sqrtUpperPriceDen: pool.priceUpperDen,
          lpFeeRate: pool.lpFeeRate,
          platformFeeX: pool.platformFeeA,
          platformFeeY: pool.platformFeeB,
          minXChange: pool.minAChange,
          minYChange: pool.minBChange,
          circulatingLPToken: pool.lpTokenTotalSupply,
          lastWithdrawEpoch: pool.lastWithdrawEpoch,
        };

        return {
          outRef: pool.outRef,
          address: pool.address,
          coin: pool.coin,
          multiAssets: pool.multiAssets,
          datum: datum,
          validityNft: pool.validityNft,
        };
      });
    } catch (error) {
      console.error("Error fetching pools:", error);
      throw new Error("Could not fetch pools from the API.");
    }
  }

  /**
   * Extracts concentrated liquidity pool data from a given Ogmios transaction.
   *
   * This method scans the transaction outputs for tokens associated with the configured
   * pool script hash. When a pool NFT is detected, it decodes the inline datum and
   * assets to return a structured `ConcentratedPool` object.
   *
   * @param tx The transaction object conforming to the Ogmios schema.
   * @returns An array of `ConcentratedPool` objects found in the transaction outputs.
   */
  getPoolsFromOgmiosTx(
    tx: Transaction,
  ): ConcentratedPool[] {
    const concentratedPools: ConcentratedPool[] = [];

    tx.outputs.forEach((utxo, index) => {
      const val = utxo.value;
      const policyAssets = val[this.poolScriptHash];

      if (policyAssets && utxo.datum) {
        for (const [assetName, quantity] of Object.entries(policyAssets)) {
          if (quantity === 1n) {
            const poolNft = this.poolScriptHash + assetName;
            const outRef = `${tx.id}#${index}`;
            const coin = val.ada.lovelace.toString();
            const multiAssets: MultiAsset[] = buildMultiAssetsFromAssets(val);
            const datum: PoolDatum = parseDatum(utxo.datum);

            const tokenA = datum.tokenX;
            const tokenB = datum.tokenY;

            const getTokenReserve = (tokenId: string) => {
              const id = tokenId.replace(".", "");
              if (id === "lovelace" || id === "") return coin;
              const policyId = id.slice(0, 56);
              const assetName = id.slice(56);
              const policyGroup = multiAssets.find(
                (ma) => ma.policyId === policyId
              );
              const asset = policyGroup?.assets.find((a) => a.name === assetName);
              return asset ? asset.value : "0";
            };

            concentratedPools.push({
              outRef,
              address: utxo.address,
              coin,
              multiAssets,
              validityNft: poolNft,
              tokenA,
              tokenAReserve: getTokenReserve(tokenA),
              tokenB,
              tokenBReserve: getTokenReserve(tokenB),
              lpFeeRate: datum.lpFeeRate,
              priceLowerNum: datum.sqrtLowerPriceNum,
              priceLowerDen: datum.sqrtLowerPriceDen,
              priceUpperNum: datum.sqrtUpperPriceNum,
              priceUpperDen: datum.sqrtUpperPriceDen,
              platformFeeA: datum.platformFeeX,
              platformFeeB: datum.platformFeeY,
              minAChange: datum.minXChange,
              minBChange: datum.minYChange,
              lpTokenTotalSupply: datum.circulatingLPToken,
              lastWithdrawEpoch: datum.lastWithdrawEpoch,
            });
          }
        }
      }
    });
    return concentratedPools;
  }
}

export default DanogoSwap;