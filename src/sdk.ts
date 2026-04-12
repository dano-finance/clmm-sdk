import {
  RewardAccount,
  RewardAddress,
  SigningClient,
  UTxO,
} from "@evolution-sdk/evolution";
import { SigningTransactionBuilder } from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder";
import { InlineDatum } from "@evolution-sdk/evolution/InlineDatum";
import { fromScript } from "@evolution-sdk/evolution/ScriptHash";
import { fromAsset, merge, quantityOf, fromLovelace, subtractLovelace } from "@evolution-sdk/evolution/Assets";
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
  calculateMultiPoolSwap,
  getEpoch,
  getPoolProtocolConfigIdx,
  toEvoOutRef,
} from "./utils.js";
import { ADA_UNIT, getNetworkConfig } from "./constants.js";
import { toHex } from "@evolution-sdk/evolution/Bytes32";

class DanogoClmm {
  constructor() { }


  /**
   * Calculates the expected output amount for a swap across multiple liquidity pools.
   *
   * This function retrieves the latest pool states from the blockchain and performs routing
   * calculations to estimate the best swap outcome across multiple pools.
   *
   * @param client An initialized SigningClient instance used to query the blockchain.
   * @param request The quote request object containing pool references and the swap amount.
   *                - `pools`: Array of pool objects with poolOutRef, deltaAmount, and optional stakingOutRef
   *                - `protocolConfigOutRef`: Reference to the protocol configuration UTxO
   * @returns A promise that resolves to a `bigint` representing the estimated total output token amount.
   *
   * @example
   * ```typescript
   * const quote = await sdk.calculateSwapOut(client, {
   *   pools: [
   *     {
   *       poolOutRef: pool1OutRef,
   *       deltaAmount: 500_000n, // 0.5 ADA to pool 1
   *       stakingOutRef: staking1OutRef
   *     },
   *     {
   *       poolOutRef: pool2OutRef,
   *       deltaAmount: 500_000n, // 0.5 ADA to pool 2
   *       stakingOutRef: staking2OutRef
   *     }
   *   ],
   *   protocolConfigOutRef: protocolConfigRef
   * });
   * ```
   */
  async calculateSwapOut(
    client: SigningClient,
    request: QuoteSwapRequest,
  ): Promise<bigint[]> {
    if (!client || !client.address) {
      throw new Error("Please connect a wallet first.");
    }
    const networkId = (await client.address()).networkId;
    const currentEpoch = getEpoch(Date.now(), networkId);

    // Fetch all pool UTxOs
    const poolUtxos = await Promise.all(
      request.pools.map(async pool =>
        this.getUtxoOrThrow(
          await client.getUtxosByOutRef([toEvoOutRef(pool.poolOutRef)]),
          `Pool input ${pool.poolOutRef}`,
        )
      )
    );

    const config = getNetworkConfig(networkId);
    const protocolConfigOutRef = request.protocolConfigOutRef ?? config.protocolScriptOutRef;

    // Fetch protocol config
    const protocolConfigUtxo = this.getUtxoOrThrow(
      await client.getUtxosByOutRef([toEvoOutRef(protocolConfigOutRef)]),
      `Protocol config ${protocolConfigOutRef}`,
    );
    if (!protocolConfigUtxo.datumOption) {
      throw new Error("Protocol config UTxO does not contain a datum.");
    }
    const protocolConfigDatum = parseProtocolConfigDatum(
      protocolConfigUtxo.datumOption as InlineDatum,
    );

    // Prepare pool data for calculation
    const poolsData = await Promise.all(
      request.pools.map(async (pool, index) => {
        const poolUtxo = poolUtxos[index];
        if (!poolUtxo.datumOption) {
          throw new Error(`Pool input UTxO ${index} does not contain a datum.`);
        }

        const poolDatum: PoolDatum = parseDatum(
          poolUtxo.datumOption as InlineDatum,
        );
        const tokenA = getPolicyIdAssetNameFromUnit(poolDatum.tokenX);
        const tokenB = getPolicyIdAssetNameFromUnit(poolDatum.tokenY);
        const coin = poolUtxo.assets.lovelace;
        const getTokenAmount = (token: typeof tokenA) => {
          if (token.unit === ADA_UNIT) return coin;
          return quantityOf(poolUtxo.assets, token.policyId!, token.assetName!);
        };

        let stakingRefUtxo = null;
        if (pool.stakingOutRef) {
          stakingRefUtxo = this.getUtxoOrThrow(
            await client.getUtxosByOutRef([toEvoOutRef(pool.stakingOutRef)]),
            `Staking reference ${pool.stakingOutRef}`,
          );
        }

        let rewardAmount = 0n;
        if (tokenA.unit === ADA_UNIT && currentEpoch > poolDatum.lastWithdrawEpoch && stakingRefUtxo) {
          const result = await this.getStakingRewards(
            client,
            networkId,
            stakingRefUtxo,
            tokenA
          );
          rewardAmount = result.rewardAmount;
        }

        return {
          tokenAAmount: getTokenAmount(tokenA),
          tokenBAmount: getTokenAmount(tokenB),
          datum: poolDatum,
          rewardAmount,
        };
      })
    );

    // Calculate multi-pool swap
    const deltaAmounts = request.pools.map(pool => pool.deltaAmount);
    const swapResults = calculateMultiPoolSwap(
      poolsData,
      deltaAmounts,
      protocolConfigDatum.platformFeeRate
    );

    // Return all output amounts
    return swapResults.map(result => result.outputAmount);
  }


  /**
   * Builds and submits a swap transaction to the network.
   *
   * This method performs a swap across one or more liquidity pools in a single transaction,
   * potentially splitting the input amount across multiple pools for better price execution.
   *
   * @param client An initialized SigningClient instance with a connected wallet.
   * @param request The swap request object containing pool references, swap amount, and minimum output.
   *                - `pools`: Array of pool objects with poolOutRef, deltaAmount, and optional stakingOutRef
   *                - `minOutChangeAmount`: Minimum acceptable output amount (slippage protection)
   *                - `protocolConfigOutRef`: Reference to the protocol configuration UTxO
   * @returns A promise that resolves to the transaction hash.
   *
   * @example
   * ```typescript
   * const txHash = await sdk.submitSwap(client, {
   *   pools: [
   *     {
   *       poolOutRef: pool1OutRef,
   *       deltaAmount: 500_000n, // 0.5 ADA to pool 1
   *       stakingOutRef: staking1OutRef
   *     },
   *     {
   *       poolOutRef: pool2OutRef,
   *       deltaAmount: 500_000n, // 0.5 ADA to pool 2
   *       stakingOutRef: staking2OutRef
   *     }
   *   ],
   *   poolScriptOutRef: poolScriptRef,
   *   minOutChangeAmount: 900_000n, // Minimum 0.9 tokens out
   *   protocolConfigOutRef: protocolConfigRef
   * });
   * ```
   */
  async submitSwap(
    client: SigningClient,
    request: SwapRequest,
  ): Promise<string> {
    if (!client || !client.address) {
      throw new Error("Please connect a wallet first.");
    }
    const networkId = (await client.address()).networkId;
    const currentEpoch = getEpoch(Date.now(), networkId);

    // Fetch all pool UTxOs and script UTxO
    const poolUtxos: UTxO.UTxO[] = await Promise.all(
      request.pools.map(async pool =>
        this.getUtxoOrThrow(
          await client.getUtxosByOutRef([toEvoOutRef(pool.poolOutRef)]),
          `Pool input ${pool.poolOutRef}`,
        )
      )
    );

    const config = getNetworkConfig(networkId);
    const poolScriptOutRef = config.poolScriptOutRef;
    const protocolConfigOutRef = request.protocolConfigOutRef ?? config.protocolScriptOutRef;

    const poolScriptUtxo = this.getUtxoOrThrow(
      await client.getUtxosByOutRef([toEvoOutRef(poolScriptOutRef)]),
      `Pool script ${poolScriptOutRef}`,
    );

    // Fetch protocol config
    const protocolConfigUtxo = this.getUtxoOrThrow(
      await client.getUtxosByOutRef([toEvoOutRef(protocolConfigOutRef)]),
      `Protocol config ${protocolConfigOutRef}`,
    );
    if (!protocolConfigUtxo.datumOption) {
      throw new Error("Protocol config UTxO does not contain a datum.");
    }
    const protocolConfigDatum = parseProtocolConfigDatum(
      protocolConfigUtxo.datumOption as InlineDatum,
    );

    // Prepare pool data and calculate swap results
    const poolsData = [];
    const stakingUtxos = [];

    for (let i = 0; i < request.pools.length; i++) {
      const pool = request.pools[i];
      const poolUtxo = poolUtxos[i];

      if (!poolUtxo.datumOption) {
        throw new Error(`Pool input UTxO ${i} does not contain a datum.`);
      }

      const poolDatum: PoolDatum = parseDatum(
        poolUtxo.datumOption as InlineDatum,
      );
      const tokenA = getPolicyIdAssetNameFromUnit(poolDatum.tokenX);
      const tokenB = getPolicyIdAssetNameFromUnit(poolDatum.tokenY);
      const coin = poolUtxo.assets.lovelace;
      const getTokenAmount = (token: typeof tokenA) => {
        if (token.unit === ADA_UNIT) return coin;
        return quantityOf(poolUtxo.assets, token.policyId!, token.assetName!);
      };

      let stakingRefUtxo = null;
      if (pool.stakingOutRef) {
        stakingRefUtxo = this.getUtxoOrThrow(
          await client.getUtxosByOutRef([toEvoOutRef(pool.stakingOutRef)]),
          `Staking reference ${pool.stakingOutRef}`,
        );
      }
      stakingUtxos.push(stakingRefUtxo);

      let rewardAmount = 0n;
      let stakingRewardAddress: RewardAddress.RewardAddress | undefined;
      if (tokenA.unit === ADA_UNIT && currentEpoch > poolDatum.lastWithdrawEpoch && stakingRefUtxo) {
        const result = await this.getStakingRewards(
          client,
          networkId,
          stakingRefUtxo,
          tokenA
        );
        rewardAmount = result.rewardAmount;
        stakingRewardAddress = result.stakingRewardAddress;
      }

      poolsData.push({
        tokenAAmount: getTokenAmount(tokenA),
        tokenBAmount: getTokenAmount(tokenB),
        datum: poolDatum,
        rewardAmount,
        utxo: poolUtxo,
        tokenA,
        tokenB,
        stakingRewardAddress,
      });
    }

    // Calculate multi-pool swap
    const deltaAmounts = request.pools.map(pool => pool.deltaAmount);
    const swapResults = calculateMultiPoolSwap(
      poolsData,
      deltaAmounts,
      protocolConfigDatum.platformFeeRate
    );

    // Check output meets minimum for each pool
    swapResults.forEach((result, index) => {
      const minOut = request.pools[index].minOutChangeAmount;
      if (result.outputAmount < minOut) {
        throw new Error(
          `Expected swap output at least ${minOut} but got ${result.outputAmount}`,
        );
      }
    });

    // // Check user has enough input tokens
    // const totalInputAmount = swapResults.reduce((sum, result) => sum + result.deltaAmount, 0n);
    // // Determine input token from the first non-zero delta amount
    // const firstNonZeroDelta = request.pools.find(pool => pool.deltaAmount !== 0n);
    // if (!firstNonZeroDelta) {
    //   throw new Error("At least one pool must have a non-zero delta amount");
    // }
    // const inputToken = firstNonZeroDelta.deltaAmount > 0 ? poolsData[0].tokenA : poolsData[0].tokenB;
    // const totalTokenInBalance = await this.getUserTokenBalance(client, inputToken);
    // if (totalTokenInBalance < totalInputAmount) {
    //   throw new Error(
    //     `Insufficient ${inputToken.unit} balance. Required: ${totalInputAmount}, Available: ${totalTokenInBalance}`,
    //   );
    // }

    // Initialize transaction builder
    let tx: SigningTransactionBuilder = client.newTx();

    // Add reference inputs
    const referenceInputs = [protocolConfigUtxo];
    referenceInputs.push(poolScriptUtxo);
    stakingUtxos.forEach(staking => {
      if (staking) referenceInputs.push(staking);
    });
    tx = tx.readFrom({ referenceInputs });

    // Process each pool
    const protocolConfigIdx = getPoolProtocolConfigIdx(
      protocolConfigUtxo,
      referenceInputs,
    );

    // Add withdrawal
    tx = tx.withdraw({
      stakeCredential: fromScript(poolScriptUtxo.scriptRef!),
      amount: 0n,
      redeemer: swapTokensRedeemer(
        null,
        poolUtxos,
        deltaAmounts,
        protocolConfigIdx,
      ),
    });

    for (let i = 0; i < poolsData.length; i++) {
      const pool = poolsData[i];
      const swapResult = swapResults.find(r => r.poolIndex === i);
      if (!swapResult) continue;

      const tokenInIsX = swapResult.tokenIn == pool.datum.tokenX;
      const platformFee = swapResult.platformFee;

      // Transform pool datum
      const transformedDatum = transformPoolDatum({
        ...pool.datum,
        platformFeeX:
          BigInt(pool.datum.platformFeeX) +
          (tokenInIsX ? platformFee : 0n),
        platformFeeY:
          BigInt(pool.datum.platformFeeY) +
          (!tokenInIsX ? platformFee : 0n),
        lastWithdrawEpoch: currentEpoch,
        totalSwapFee:
          BigInt(pool.datum.totalSwapFee) + BigInt(protocolConfigDatum.swapFee),
      });

      // Calculate output assets
      const deltaAssets = this.buildDeltaAssets(
        tokenInIsX ? pool.tokenA : pool.tokenB,
        tokenInIsX ? pool.tokenB : pool.tokenA,
        swapResult.inputAmount,
        swapResult.outputAmount,
        protocolConfigDatum.swapFee
      );
      const poolOutAssets = merge(pool.utxo.assets, deltaAssets);

      // Add pool output
      tx = tx.payToAddress({
        address: pool.utxo.address,
        assets: poolOutAssets,
        datum: transformedDatum,
      });

      // Add spend
      tx = tx.collectFrom({
        inputs: [pool.utxo],
        redeemer: swapTokensRedeemer(
          pool.utxo,
          poolUtxos,
          deltaAmounts,
          protocolConfigIdx,
        ),
      });

      // Handle staking rewards if applicable
      if (pool.stakingRewardAddress) {
        tx = tx.withdraw({
          stakeCredential: fromScript(stakingUtxos[i]!.scriptRef!),
          amount: pool.rewardAmount || 0n,
          redeemer: swapTokensRedeemer(
            pool.utxo,
            poolUtxos,
            deltaAmounts,
            protocolConfigIdx,
          ),
        });
      }
    }

    // Add metadata
    tx = tx.attachMetadata({
      label: 674n,
      metadata: new Map([["msg", ["Danogo Multi-Pool Swap"]]]),
    });

    // Finalize and submit
    tx.setValidity({
      from: BigInt(Date.now() - 120000),
      to: BigInt(Date.now() + 240000),
    });
    const builtTx = await tx.build({
      scriptDataFormat: "array"
    });
    const signedTx = await builtTx.sign();
    const txHash = await signedTx.submit();
    return toHex(txHash.hash);
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
    networkId: number,
    poolScriptHash?: string,
  ): ConcentratedPool[] {
    const config = getNetworkConfig(networkId);
    const scriptHash = poolScriptHash ?? config.poolScriptHash;

    if (!scriptHash) {
      throw new Error("Pool script hash is required but not provided or not found for this network.");
    }

    const concentratedPools: ConcentratedPool[] = [];

    tx.outputs.forEach((utxo, index) => {
      const val = utxo.value;
      const policyAssets = val[scriptHash];

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
              if (tokenId === ADA_UNIT) return coin;
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

  private getUtxoOrThrow(
    utxos: UTxO.UTxO[] | undefined,
    description: string,
  ): UTxO.UTxO {
    if (!utxos || utxos.length === 0) {
      throw new Error(`${description} UTxO not found or spent.`);
    }
    return utxos[0];
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
        (token.unit === ADA_UNIT
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
    amountIn: bigint,
    amountOut: bigint,
    swapFee: bigint
  ): any {
    let deltaAssets: any;

    // Input amount (including swap fee)
    if (tokenIn.unit === ADA_UNIT) {
      deltaAssets = fromLovelace(amountIn + swapFee);
    } else {
      deltaAssets = fromAsset(tokenIn.policyId, tokenIn.assetName, amountIn, swapFee);
    }

    // Output amount
    if (tokenOut.unit === ADA_UNIT) {
      deltaAssets = subtractLovelace(deltaAssets, amountOut);
    } else {
      const outputAssets = fromAsset(tokenOut.policyId, tokenOut.assetName, -amountOut);
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
    if (tokenA.unit !== ADA_UNIT) {
      return { rewardAmount: 0n };
    }

    if (!stakingRefUtxo) {
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

export default DanogoClmm;
export {
  ConcentratedPool,
  PoolDatum,
  SwapRequest,
  QuoteSwapRequest,
  toEvoOutRef
};
