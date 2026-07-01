import { Interface } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import { ERC20_ABI, SWAP_ROUTER_ABI } from "./config.js";
import { CHAIN, UNISWAP } from "./network.js";
import { getAccount } from "./wallet.js";

const GASLESS_KEY = "tickerflux-gasless";
let sponsorConfig = null;

export function isGaslessPreferred() {
  return localStorage.getItem(GASLESS_KEY) === "1";
}

export function setGaslessPreferred(on) {
  localStorage.setItem(GASLESS_KEY, on ? "1" : "0");
}

export async function loadGaslessConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) sponsorConfig = await res.json();
  } catch {
    sponsorConfig = { gasless: false, batch: true };
  }
  return sponsorConfig;
}

export function gaslessSponsorActive() {
  return Boolean(sponsorConfig?.gasless && sponsorConfig?.paymasterUrl);
}

export function gaslessBatchAvailable() {
  return sponsorConfig?.batch !== false;
}

function encodeApprove(token, spender, amount) {
  const iface = new Interface(ERC20_ABI);
  return iface.encodeFunctionData("approve", [spender, amount]);
}

function encodeSwap(params) {
  const iface = new Interface(SWAP_ROUTER_ABI);
  return iface.encodeFunctionData("exactInputSingle", [params]);
}

export async function tryBatchSwapCalls({ tokenIn, approveAmount, swapParams, normalExecute }) {
  const account = getAccount();
  if (!account || !window.ethereum?.request) return normalExecute();

  const spender = UNISWAP.router;
  const calls = [];

  if (approveAmount > 0n) {
    calls.push({
      to: tokenIn.address,
      data: encodeApprove(tokenIn.address, spender, approveAmount),
      value: "0x0",
    });
  }

  calls.push({
    to: spender,
    data: encodeSwap(swapParams),
    value: "0x0",
  });

  const capabilities = {};
  if (gaslessSponsorActive() && sponsorConfig.paymasterUrl) {
    capabilities.paymasterService = { url: sponsorConfig.paymasterUrl };
  }

  try {
    const payload = {
      version: "1.0",
      chainId: CHAIN.hexId,
      from: account,
      calls,
    };
    if (Object.keys(capabilities).length) payload.capabilities = capabilities;

    const result = await window.ethereum.request({
      method: "wallet_sendCalls",
      params: [payload],
    });

    const id = result?.id || result;
    if (id && typeof id === "string") {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await window.ethereum.request({
          method: "wallet_getCallsStatus",
          params: [id],
        });
        if (status?.status === 200 && status?.receipts?.[0]?.transactionHash) {
          return { hash: status.receipts[status.receipts.length - 1].transactionHash, batched: true, gasless: gaslessSponsorActive() };
        }
        if (status?.status >= 400) throw new Error(status?.error?.message || "Batch swap failed.");
      }
      throw new Error("Batch swap timed out.");
    }
    return { hash: result, batched: true, gasless: gaslessSponsorActive() };
  } catch (err) {
    if (err?.code === 4001) throw err;
    return normalExecute();
  }
}

export async function executeWithGaslessOption(ctx) {
  const { tokenIn, approveAmount, swapParams, normalExecute } = ctx;
  const useBatch = isGaslessPreferred() && (gaslessBatchAvailable() || gaslessSponsorActive());
  if (!useBatch) return normalExecute();

  return tryBatchSwapCalls({
    tokenIn,
    approveAmount,
    swapParams,
    normalExecute,
  });
}