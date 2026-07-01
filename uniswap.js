import { Contract, ZeroAddress } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import {
  ERC20_ABI,
  UNISWAP_FACTORY_ABI,
  UNISWAP_POOL_ABI,
  QUOTER_V2_ABI,
  SWAP_ROUTER_ABI,
} from "./config.js";
import { USDG, UNISWAP } from "./network.js";
import { getReadProvider, getSigner } from "./wallet.js";

const Q96 = 2n ** 96n;
const ZERO_ADDR = ZeroAddress;

function factory() {
  return new Contract(UNISWAP.factory, UNISWAP_FACTORY_ABI, getReadProvider());
}

function quoter() {
  return new Contract(UNISWAP.quoter, QUOTER_V2_ABI, getReadProvider());
}

function poolAt(address) {
  return new Contract(address, UNISWAP_POOL_ABI, getReadProvider());
}

function erc20At(address) {
  return new Contract(address, ERC20_ABI, getReadProvider());
}

export function routerContract(writable = false) {
  const signer = writable ? getSigner() : null;
  return new Contract(UNISWAP.router, SWAP_ROUTER_ABI, signer || getReadProvider());
}

export async function findBestPool(stock) {
  const fac = factory();
  let best = null;
  for (const fee of UNISWAP.feeTiers) {
    try {
      const poolAddr = await fac.getPool(stock.address, USDG.address, fee);
      if (!poolAddr || poolAddr === ZERO_ADDR) continue;
      const pool = poolAt(poolAddr);
      const liquidity = await pool.liquidity();
      if (liquidity === 0n) continue;
      if (!best || liquidity > best.liquidity) {
        best = { address: poolAddr, fee, liquidity };
      }
    } catch {
      /* try next fee tier */
    }
  }
  return best;
}

export async function getPoolReserves(stock, poolMeta) {
  if (!poolMeta?.address) return { pool: [0n, 0n], meta: null, midPrice: null };
  try {
    const pool = poolAt(poolMeta.address);
    const [token0, token1, slot0] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.slot0(),
    ]);
    const bal0 = await erc20At(token0).balanceOf(poolMeta.address);
    const bal1 = await erc20At(token1).balanceOf(poolMeta.address);
    const stockLower = stock.address.toLowerCase();
    const usdgLower = USDG.address.toLowerCase();
    const t0 = token0.toLowerCase();
    const reserveStock = t0 === stockLower ? bal0 : bal1;
    const reserveUsdg = t0 === usdgLower ? bal0 : bal1;
    const midPrice = midPriceFromSqrt(slot0.sqrtPriceX96 ?? slot0[0], token0, stock);
    return {
      pool: [reserveStock, reserveUsdg],
      meta: { ...poolMeta, token0, token1 },
      midPrice,
    };
  } catch {
    return { pool: [0n, 0n], meta: poolMeta, midPrice: null };
  }
}

export function midPriceFromSqrt(sqrtPriceX96, token0, stock) {
  if (!sqrtPriceX96 || sqrtPriceX96 === 0n) return null;
  const sqrt = Number(sqrtPriceX96) / Number(Q96);
  const ratio = sqrt * sqrt;
  const t0Stock = token0.toLowerCase() === stock.address.toLowerCase();
  const adj = 10 ** (stock.decimals - USDG.decimals);
  if (t0Stock) return ratio * adj;
  if (!ratio) return null;
  return (1 / ratio) * (10 ** (USDG.decimals - stock.decimals));
}

export async function quoteExactIn(stock, tokenIn, amountIn, fee) {
  const tokenOut = tokenIn.address.toLowerCase() === USDG.address.toLowerCase() ? stock : USDG;
  const result = await quoter().quoteExactInputSingle.staticCall({
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0n,
  });
  const amountOut = result.amountOut ?? result[0];
  return amountOut;
}

export async function executeExactIn(stock, tokenIn, amountIn, minOut, fee, recipient) {
  const tokenOut = tokenIn.address.toLowerCase() === USDG.address.toLowerCase() ? stock : USDG;
  const router = routerContract(true);
  return router.exactInputSingle({
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    fee,
    recipient,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  });
}

export async function fetchPoolSwapEvents(poolAddress, fromBlock, toBlock) {
  if (!poolAddress) return [];
  const pool = poolAt(poolAddress);
  return pool.queryFilter(pool.filters.Swap(), fromBlock, toBlock);
}

export function parsePoolSwapEvent(ev, stock, token0) {
  const amount0 = ev.args?.amount0 ?? ev.args?.[2];
  const amount1 = ev.args?.amount1 ?? ev.args?.[3];
  if (amount0 === undefined || amount1 === undefined || !token0) return null;

  const t0Stock = token0.toLowerCase() === stock.address.toLowerCase();
  let side;
  let amountIn;
  let amountOut;
  let tokenIn;
  let tokenOut;

  if (t0Stock) {
    if (amount0 > 0n) {
      side = "sell";
      tokenIn = stock;
      tokenOut = USDG;
      amountIn = amount0;
      amountOut = amount1 < 0n ? -amount1 : amount1;
    } else {
      side = "buy";
      tokenIn = USDG;
      tokenOut = stock;
      amountIn = amount1 > 0n ? amount1 : -amount1;
      amountOut = amount0 < 0n ? -amount0 : amount0;
    }
  } else if (amount0 > 0n) {
    side = "buy";
    tokenIn = USDG;
    tokenOut = stock;
    amountIn = amount0;
    amountOut = amount1 < 0n ? -amount1 : amount1;
  } else {
    side = "sell";
    tokenIn = stock;
    tokenOut = USDG;
    amountIn = amount1 > 0n ? amount1 : -amount1;
    amountOut = amount0 < 0n ? -amount0 : amount0;
  }

  return {
    stock,
    user: ev.args?.recipient ?? ev.args?.[1],
    side,
    amountIn,
    amountOut,
    tokenIn,
    tokenOut,
    tx: ev.transactionHash,
    block: ev.blockNumber,
  };
}