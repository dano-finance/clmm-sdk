import {
  LucidEvolution,
  TxBuilder,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import {
  Transaction,
} from "@cardano-ogmios/schema";
import { swapTokensRedeemer } from "./redeemer.js";
import { PoolDatum, parseDatum, transformPoolDatum } from "./datum.js";
import { buildMultiAssetsFromAssets, MultiAsset } from "./multiAssets.js";
import { ConcentratedPool, QuoteSwapRequest, SwapRequest } from "./concentratedPool.js";
import { calculateConcentratedPoolSwap, getEpoch } from "./utils.js";

class DanogoSwap {
  constructor() {}

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
  async calculateSwapOut(
    lucid: LucidEvolution,
    request: QuoteSwapRequest
  ): Promise<bigint> {
    if (!lucid || !lucid.wallet()) {
      throw new Error("Please connect a wallet first.");
    }
    const poolInUtxo = (
      await lucid.utxosByOutRef([
        {
          txHash: request.poolOutRef.txHash,
          outputIndex: request.poolOutRef.outputIndex,
        },
      ])
    )[0];
    let stakingRefUtxo = null;
    if (request.stakingOutRef) {
      stakingRefUtxo = (
        await lucid.utxosByOutRef([
          {
            txHash: request.stakingOutRef.txHash,
            outputIndex: request.stakingOutRef.outputIndex,
          },
        ])
      )[0];
    }
    if (!poolInUtxo.datum) {
      throw new Error("Pool input UTxO does not contain a datum.");
    }

    const poolInDatum: PoolDatum = parseDatum(poolInUtxo.datum);
    const tokenA = poolInDatum.tokenX || "lovelace";
    const tokenB = poolInDatum.tokenY;
    const coin = poolInUtxo.assets.lovelace;
    const getTokenAmount = (tokenId: string) => {
      if (tokenId === "lovelace") return coin;
      for (const [token, quantity] of Object.entries(poolInUtxo.assets)) {
        if (token === tokenId) return quantity;
      }
      return 0n;
    };

    // Initialize the transaction builder
    let tx: TxBuilder = lucid.newTx();

    let rewardAmount = 0n,
      stakingRewardAddress = "";
    if (tokenA == "lovelace") {
      stakingRewardAddress = validatorToRewardAddress(
        lucid.config().network!,
        stakingRefUtxo!.scriptRef!
      );
      try {
        rewardAmount = (await lucid.delegationAt(stakingRewardAddress)).rewards;
      } catch (e) {
        rewardAmount = 0n;
      }
    }
    const [tokenToReceiveAmount, _] = calculateConcentratedPoolSwap(
      getTokenAmount(tokenA),
      getTokenAmount(tokenB),
      poolInDatum,
      request.deltaAmount,
      rewardAmount
    );

    return tokenToReceiveAmount;
  }

  /**
   * Builds and submits a swap transaction to the network.
   *
   * @param lucid An initialized Lucid instance with a connected wallet.
   * @param request The swap request object containing pool reference, swap amount, and minimum output.
   * @returns A promise that resolves to the transaction hash.
   */
  async submitSwap(
    lucid: LucidEvolution,
    request: SwapRequest
  ): Promise<string> {
    if (!lucid || !lucid.wallet()) {
      throw new Error("Please connect a wallet first.");
    }
    const poolInUtxo = (
      await lucid.utxosByOutRef([
        {
          txHash: request.poolOutRef.txHash,
          outputIndex: request.poolOutRef.outputIndex,
        },
      ])
    )[0];
    const poolScriptUtxo = (
      await lucid.utxosByOutRef([
        {
          txHash: request.poolScriptOutRef.txHash,
          outputIndex: request.poolScriptOutRef.outputIndex,
        },
      ])
    )[0]
    let stakingRefUtxo = null;
    if (request.stakingOutRef) {
      stakingRefUtxo = (
        await lucid.utxosByOutRef([
          {
            txHash: request.stakingOutRef.txHash,
            outputIndex: request.stakingOutRef.outputIndex,
          },
        ])
      )[0];
    }
    if (!poolInUtxo.datum) {
      throw new Error("Pool input UTxO does not contain a datum.");
    }

    const poolInDatum: PoolDatum = parseDatum(poolInUtxo.datum);
    const tokenA = poolInDatum.tokenX || "lovelace";
    const tokenB = poolInDatum.tokenY;
    const coin = poolInUtxo.assets.lovelace;
    const getTokenAmount = (tokenId: string) => {
      if (tokenId === "lovelace") return coin;
      for (const [token, quantity] of Object.entries(poolInUtxo.assets)) {
        if (token === tokenId) return quantity;
      }
      return 0n;
    };

    const deltaAmount = request.deltaAmount;
    const tokenIn = deltaAmount > 0 ? tokenA : tokenB;
    const tokenOut = deltaAmount > 0 ? tokenB : tokenA;

    // Initialize the transaction builder
    let tx: TxBuilder = lucid.newTx();

    // 1. Check user wallet has enough tokenIn
    const userUtxos = await lucid.wallet().getUtxos();
    const totalTokenInBalance = userUtxos.reduce(
      (acc, utxo) => acc + (utxo.assets[tokenIn] || 0n),
      0n
    );
    const requiredAmount = deltaAmount < 0n ? -deltaAmount : deltaAmount;
    if (totalTokenInBalance < requiredAmount) {
      throw new Error(
        `Insufficient ${tokenIn} balance. Required: ${requiredAmount}, Available: ${totalTokenInBalance}`
      );
    }

    // 3. Add Reference Inputs
    tx = tx.readFrom([poolScriptUtxo]);
    if (stakingRefUtxo) {
      tx = tx.readFrom([stakingRefUtxo]);
    }

    // 4. Add Outputs
    let rewardAmount = 0n,
      stakingRewardAddress = "";
    if (tokenA == "lovelace") {
      stakingRewardAddress = validatorToRewardAddress(
        lucid.config().network!,
        stakingRefUtxo!.scriptRef!
      );
      try {
        rewardAmount = (await lucid.delegationAt(stakingRewardAddress)).rewards;
      } catch (e) {
        rewardAmount = 0n;
      }
    }
    const [tokenToReceiveAmount, platformFee] = calculateConcentratedPoolSwap(
      getTokenAmount(tokenA),
      getTokenAmount(tokenB),
      poolInDatum,
      deltaAmount,
      rewardAmount
    );
    if (tokenToReceiveAmount < request.minOutChangeAmount) {
      throw new Error(
        `Slippage too high. Expected at least ${request.minOutChangeAmount} but got ${tokenToReceiveAmount}`
      );
    }

    const currentEpoch = getEpoch(Date.now(), lucid.config().network!);
    const transformedDatum = transformPoolDatum({
      ...poolInDatum,
      platformFeeX:
        BigInt(poolInDatum.platformFeeX) +
        (tokenIn === poolInDatum.tokenX ? platformFee : 0n),
      platformFeeY:
        BigInt(poolInDatum.platformFeeY) +
        (tokenIn === poolInDatum.tokenY ? platformFee : 0n),
      lastWithdrawEpoch: currentEpoch,
    });
    const poolOutAssets = { ...poolInUtxo.assets };
    poolOutAssets[tokenIn] =
      poolOutAssets[tokenIn] + (deltaAmount > 0n ? deltaAmount : -deltaAmount);
    poolOutAssets[tokenOut] =
      BigInt(poolOutAssets[tokenOut]) - BigInt(tokenToReceiveAmount);
    tx = tx.pay.ToAddressWithData(
      poolInUtxo.address,
      {
        kind: "inline",
        value: transformedDatum,
      },
      poolOutAssets
    );

    // 5. Add Metadata
    tx = tx.attachMetadata(674, {
      msg: ["Danogo Liquidity Pair: Swap"],
    });

    // 6. Add spend & withdrawal
    tx = tx.collectFrom([poolInUtxo], swapTokensRedeemer([poolInUtxo], [deltaAmount]));
    tx = tx.withdraw(
      validatorToRewardAddress(
        lucid.config().network!,
        poolScriptUtxo.scriptRef!
      ),
      0n,
      swapTokensRedeemer([poolInUtxo], [deltaAmount])
    );
    // if tokenX is ADA
    if (tokenA === "lovelace" && currentEpoch > poolInDatum.lastWithdrawEpoch)
      tx = tx.withdraw(
        stakingRewardAddress,
        rewardAmount,
        swapTokensRedeemer([poolInUtxo], [deltaAmount])
      );

    // 7. Finalize and Submit
    tx = tx
      .validFrom(Date.now() - 120000)
      .validTo(Date.now() + 240000)
      .setMinFee(17000n)
      .addSigner(await lucid.wallet().address());

    const builtTx = await tx.complete({
      localUPLCEval: false,
    });
    const signedTx = await builtTx.sign.withWallet().complete();
    return await signedTx.submit();
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
    poolScriptHash: string
  ): ConcentratedPool[] {
    const concentratedPools: ConcentratedPool[] = [];

    tx.outputs.forEach((utxo, index) => {
      const val = utxo.value;
      const policyAssets = val[poolScriptHash];

      if (policyAssets && utxo.datum) {
        for (const [assetName, quantity] of Object.entries(policyAssets)) {
          if (quantity === 1n) {
            const poolNft = poolScriptHash + assetName;
            const outRef = `${tx.id}#${index}`;
            const coin = val.ada.lovelace;
            const multiAssets: MultiAsset[] = buildMultiAssetsFromAssets(val);
            const datum: PoolDatum = parseDatum(utxo.datum);

            const tokenA = datum.tokenX;
            const tokenB = datum.tokenY;

            const getTokenReserve = (tokenId: string) => {
              if (tokenId === "lovelace" || tokenId === "") return coin;
              const policyId = tokenId.slice(0, 56);
              const assetName = tokenId.slice(56);
              const policyGroup = multiAssets.find(
                (ma) => ma.policyId === policyId
              );
              const asset = policyGroup?.assets.find((a) => a.name === assetName);
              return asset ? asset.value : 0n;
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
export { ConcentratedPool, PoolDatum, SwapRequest };
