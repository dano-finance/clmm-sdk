import {
  RewardAccount,
  RewardAddress,
  SigningClient,
} from "@evolution-sdk/evolution";
import { SigningTransactionBuilder } from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder";
import { InlineDatum } from "@evolution-sdk/evolution/InlineDatum";
import { fromScript } from "@evolution-sdk/evolution/ScriptHash";
import { fromAsset, merge, quantityOf, fromLovelace, addLovelace, subtractLovelace } from "@evolution-sdk/evolution/Assets";
import { Transaction } from "@cardano-ogmios/schema";
import { swapTokensRedeemer } from "./redeemer.js";
import {
  PoolDatum,
  parseDatum,
  parseProtocolConfigDatum,
  transformPoolDatum,
} from "./datum.js";
import {
  buildMultiAssetsFromAssets,
  getPolicyIdAssetNameFromUnit,
  MultiAsset,
} from "./multiAssets.js";
import {
  ConcentratedPool,
  QuoteSwapRequest,
  SwapRequest,
} from "./concentratedPool.js";
import {
  calculateConcentratedPoolSwap,
  getEpoch,
  getPoolProtocolConfigIdx,
} from "./utils.js";

class DanogoSwap {
  constructor() {}

  /**
   * Calculates the expected output amount for a swap in a specific liquidity pool.
   *
   * This function retrieves the latest pool state from the blockchain and performs a local calculation
   * to estimate the swap outcome. It does not submit any transaction to the network.
   *
   * @param lucid An initialized Lucid instance used to query the blockchain.
   * @param request The quote request object containing pool references and the swap amount.
   *                - `deltaAmount`: The amount of the input token to swap.
   *                  - Positive (> 0): Swaps Token X for Token Y.
   *                  - Negative (< 0): Swaps Token Y for Token X.
   * @returns A promise that resolves to a `bigint` representing the estimated output token amount.
   */
  async calculateSwapOut(
    client: SigningClient,
    request: QuoteSwapRequest,
  ): Promise<bigint> {
    if (!client || !client.address) {
      throw new Error("Please connect a wallet first.");
    }
    const networkId = (await client.address()).networkId;
    const poolInUtxo = (await client.getUtxosByOutRef([request.poolOutRef]))[0];
    let stakingRefUtxo = null;
    if (request.stakingOutRef) {
      stakingRefUtxo = (
        await client.getUtxosByOutRef([request.stakingOutRef])
      )[0];
    }
    if (!poolInUtxo.datumOption) {
      throw new Error("Pool input UTxO does not contain a datum.");
    }
    const protocolConfigUtxo = (
      await client.getUtxosByOutRef([request.protocolConfigOutRef])
    )[0];
    if (!protocolConfigUtxo.datumOption) {
      throw new Error("Protocol config UTxO does not contain a datum.");
    }
    const protocolConfigDatum = parseProtocolConfigDatum(
      protocolConfigUtxo.datumOption as InlineDatum,
    );
    // 1732
    const poolInDatum: PoolDatum = parseDatum(
      poolInUtxo.datumOption as InlineDatum,
    );
    const tokenA = getPolicyIdAssetNameFromUnit(poolInDatum.tokenX);
    const tokenB = getPolicyIdAssetNameFromUnit(poolInDatum.tokenY);
    const coin = poolInUtxo.assets.lovelace;
    const getTokenAmount = (token: typeof tokenA) => {
      if (token.unit === "lovelace") return coin;
      return quantityOf(poolInUtxo.assets, token.policyId!, token.assetName!);
    };

    const { rewardAmount } = await this.getStakingRewards(
      client,
      networkId,
      stakingRefUtxo,
      tokenA
    );

    const [tokenToReceiveAmount, _] = calculateConcentratedPoolSwap(
      getTokenAmount(tokenA),
      getTokenAmount(tokenB),
      poolInDatum,
      request.deltaAmount,
      rewardAmount,
      protocolConfigDatum.platformFeeRate,
    );

    return tokenToReceiveAmount;
  }

  /**
   * Builds and submits a swap transaction to the network.
   *
   * @param client An initialized SigningClient instance with a connected wallet.
   * @param request The swap request object containing pool reference, swap amount, and minimum output.
   * @returns A promise that resolves to the transaction hash.
   */
  async submitSwap(
    client: SigningClient,
    request: SwapRequest,
  ): Promise<string> {
    if (!client || !client.address) {
      throw new Error("Please connect a wallet first.");
    }
    const networkId = (await client.address()).networkId;
    const poolInUtxo = (await client.getUtxosByOutRef([request.poolOutRef]))[0];
    const poolScriptUtxo = (
      await client.getUtxosByOutRef([request.poolScriptOutRef])
    )[0];
    let stakingRefUtxo = null;
    if (request.stakingOutRef) {
      stakingRefUtxo = (
        await client.getUtxosByOutRef([request.stakingOutRef])
      )[0];
    }
    if (!poolInUtxo.datumOption) {
      throw new Error("Pool input UTxO does not contain a datum.");
    }
    const protocolConfigUtxo = (
      await client.getUtxosByOutRef([request.protocolConfigOutRef])
    )[0];
    if (!protocolConfigUtxo.datumOption) {
      throw new Error("Protocol config UTxO does not contain a datum.");
    }
    const protocolConfigDatum = parseProtocolConfigDatum(
      protocolConfigUtxo.datumOption as InlineDatum,
    );

    const poolInDatum: PoolDatum = parseDatum(
      poolInUtxo.datumOption as InlineDatum,
    );
    const tokenA = getPolicyIdAssetNameFromUnit(poolInDatum.tokenX);
    const tokenB = getPolicyIdAssetNameFromUnit(poolInDatum.tokenY);
    const coin = poolInUtxo.assets.lovelace;
    const getTokenAmount = (token: typeof tokenA) => {
      if (token.unit === "lovelace") return coin;
      return quantityOf(poolInUtxo.assets, token.policyId!, token.assetName!);
    };

    const deltaAmount = request.deltaAmount;
    const tokenIn = deltaAmount > 0 ? tokenA : tokenB;
    const tokenOut = deltaAmount > 0 ? tokenB : tokenA;

    // Initialize the transaction builder
    let tx: SigningTransactionBuilder = client.newTx();

    // 1. Check user wallet has enough tokenIn
    const totalTokenInBalance = await this.getUserTokenBalance(client, tokenIn);
    const requiredAmount = deltaAmount < 0n ? -deltaAmount : deltaAmount;
    if (totalTokenInBalance < requiredAmount) {
      throw new Error(
        `Insufficient ${tokenIn.unit} balance. Required: ${requiredAmount}, Available: ${totalTokenInBalance}`,
      );
    }

    // 3. Add Reference Inputs
    tx = tx.readFrom({ referenceInputs: [poolScriptUtxo, protocolConfigUtxo] });
    if (stakingRefUtxo) {
      tx = tx.readFrom({ referenceInputs: [stakingRefUtxo] });
    }

    // 4. Add Outputs
    const { rewardAmount, stakingRewardAddress } = await this.getStakingRewards(
      client,
      networkId,
      stakingRefUtxo,
      tokenA
    );

    const [tokenToReceiveAmount, platformFee] = calculateConcentratedPoolSwap(
      getTokenAmount(tokenA),
      getTokenAmount(tokenB),
      poolInDatum,
      deltaAmount,
      rewardAmount,
      protocolConfigDatum.platformFeeRate,
    );
    if (tokenToReceiveAmount < request.minOutChangeAmount) {
      throw new Error(
        `Slippage too high. Expected at least ${request.minOutChangeAmount} but got ${tokenToReceiveAmount}`,
      );
    }

    const currentEpoch = getEpoch(Date.now(), networkId);
    const transformedDatum = transformPoolDatum({
      ...poolInDatum,
      platformFeeX:
        BigInt(poolInDatum.platformFeeX) +
        (tokenIn.unit === tokenA.unit ? platformFee : 0n),
      platformFeeY:
        BigInt(poolInDatum.platformFeeY) +
        (tokenIn.unit === tokenB.unit ? platformFee : 0n),
      lastWithdrawEpoch: currentEpoch,
      totalSwapFee:
        BigInt(poolInDatum.totalSwapFee) + BigInt(protocolConfigDatum.swapFee),
    });

    const deltaAssets = this.buildDeltaAssets(
      tokenIn,
      tokenOut,
      deltaAmount,
      BigInt(tokenToReceiveAmount),
      BigInt(protocolConfigDatum.swapFee)
    );

    const poolOutAssets = merge(poolInUtxo.assets, deltaAssets);

    tx = tx.payToAddress({
      address: poolInUtxo.address,
      assets: poolOutAssets,
      datum: transformedDatum,
    });

    // 5. Add Metadata
    tx = tx.attachMetadata({
      label: 674n,
      metadata: new Map([["msg", ["Danogo Liquidity Pair: Swap"]]]),
    });

    // 6. Add spend & withdrawal
    const referenceInputs = [poolScriptUtxo, protocolConfigUtxo];
    if (stakingRefUtxo) {
      referenceInputs.push(stakingRefUtxo);
    }
    const protocolConfigIdx = getPoolProtocolConfigIdx(
      protocolConfigUtxo,
      referenceInputs,
    );
    tx = tx.collectFrom({
      inputs: [poolInUtxo],
      redeemer: swapTokensRedeemer(
        [poolInUtxo],
        [deltaAmount],
        protocolConfigIdx,
        false,
      ),
    });
    tx = tx.withdraw({
      stakeCredential: fromScript(poolScriptUtxo.scriptRef!),
      amount: 0n,
      redeemer: swapTokensRedeemer(
          [poolInUtxo],
          [deltaAmount],
          protocolConfigIdx,
          true,
        ),
    });
    // if tokenX is ADA
    if (
      tokenA.unit === "lovelace" &&
      currentEpoch > poolInDatum.lastWithdrawEpoch &&
      stakingRewardAddress
    )
      tx = tx.withdraw({
        stakeCredential: fromScript(stakingRefUtxo!.scriptRef!),
        amount: rewardAmount,
        redeemer: swapTokensRedeemer(
          [poolInUtxo],
          [deltaAmount],
          protocolConfigIdx,
          false,
        ),
      });

    // 7. Finalize and Submit
    tx.setValidity({
      from: BigInt(Date.now() - 120000),
      to: BigInt(Date.now() + 240000),
    });

    const builtTx = await tx.build({
      debug: true,
    });
    const signedTx = await (await builtTx.sign()).submit();
    return signedTx.toString();
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
    poolScriptHash: string,
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
                (ma) => ma.policyId === policyId,
              );
              const asset = policyGroup?.assets.find(
                (a) => a.name === assetName,
              );
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
              totalSwapFee: datum.totalSwapFee,
            });
          }
        }
      }
    });
    return concentratedPools;
  }

  /**
   * Helper function to get the balance of a specific token from user UTXOs
   */
  private async getUserTokenBalance(
    client: SigningClient,
    token: { unit: string; policyId?: any; assetName?: any }
  ): Promise<bigint> {
    const userUtxos = await client.getWalletUtxos();
    return userUtxos.reduce(
      (acc, utxo) =>
        acc +
        (token.unit === "lovelace"
          ? utxo.assets.lovelace
          : (quantityOf(utxo.assets, token.policyId, token.assetName) || 0n)),
      0n
    );
  }

  /**
   * Helper function to build delta assets for pool updates
   */
  private buildDeltaAssets(
    tokenIn: { unit: string; policyId?: any; assetName?: any },
    tokenOut: { unit: string; policyId?: any; assetName?: any },
    deltaAmount: bigint,
    tokenToReceiveAmount: bigint,
    swapFee: bigint
  ): any {
    // Input amount (including swap fee)
    const inputAmount = deltaAmount > 0n ? deltaAmount : -deltaAmount;
    let deltaAssets: any;

    if (tokenIn.unit === "lovelace") {
      deltaAssets = fromLovelace(inputAmount + swapFee);
    } else {
      deltaAssets = fromAsset(tokenIn.policyId, tokenIn.assetName, inputAmount, swapFee);
    }

    // Output amount
    if (tokenOut.unit === "lovelace") {
      deltaAssets = subtractLovelace(deltaAssets, tokenToReceiveAmount);
    } else {
      const outputAssets = fromAsset(tokenOut.policyId, tokenOut.assetName, -tokenToReceiveAmount);
      deltaAssets = merge(deltaAssets, outputAssets);
    }

    return deltaAssets;
  }

  /**
   * Helper function to handle staking rewards for ADA pools
   */
  private async getStakingRewards(
    client: SigningClient,
    networkId: number,
    stakingRefUtxo: any,
    tokenA: { unit: string }
  ): Promise<{ rewardAmount: bigint; stakingRewardAddress?: RewardAddress.RewardAddress }> {
    if (tokenA.unit !== "lovelace") {
      return { rewardAmount: 0n };
    }

    const stakingAccount = new RewardAccount.RewardAccount({
      networkId,
      stakeCredential: fromScript(stakingRefUtxo.scriptRef!),
    });
    const stakingRewardAddress = RewardAccount.toBech32(stakingAccount) as RewardAddress.RewardAddress;
    const rewardAmount = (await client.getDelegation(stakingRewardAddress)).rewards;

    return { rewardAmount, stakingRewardAddress };
  }
}

export default DanogoSwap;
export { ConcentratedPool, PoolDatum, SwapRequest, QuoteSwapRequest };
