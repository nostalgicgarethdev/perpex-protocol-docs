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
  if (sponsorConfig?.gasless && !isGaslessPreferred()) {
    setGaslessPreferred(true);
  }
  return sponsorConfig;
}

export function gaslessSponsorActive() {
  return Boolean(sponsorConfig?.gasless && sponsorConfig?.policyId);
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

async function alchemyRpc(method, params) {
  const res = await fetch("/api/alchemy-rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Alchemy RPC error");
  return data.result;
}

async function signPreparedRequest(account, signatureRequest) {
  if (!signatureRequest) throw new Error("Missing signature request");
  const type = signatureRequest.type;
  const payload = signatureRequest.data;

  if (type === "personal_sign") {
    return window.ethereum.request({
      method: "personal_sign",
      params: [payload.raw, account],
    });
  }
  if (type === "eth_signTypedData_v4") {
    const typed = typeof payload === "string" ? payload : JSON.stringify(payload);
    return window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [account, typed],
    });
  }
  throw new Error(`Unsupported signature type: ${type}`);
}

async function tryAlchemyGaslessSwap({ account, calls, policyId }) {
  const prepared = await alchemyRpc("wallet_prepareCalls", [{
    from: account,
    chainId: CHAIN.hexId,
    calls,
    capabilities: {
      paymasterService: { policyId },
    },
  }]);

  const signature = await signPreparedRequest(account, prepared.signatureRequest);

  const sendParams = {
    type: prepared.type,
    data: prepared.data,
    chainId: prepared.chainId || CHAIN.hexId,
    signature: {
      type: "secp256k1",
      data: signature,
    },
  };

  const sent = await alchemyRpc("wallet_sendPreparedCalls", [sendParams]);
  const hash = sent?.details?.data?.hash
    || sent?.preparedCallIds?.[0]
    || sent?.id;

  if (!hash) throw new Error("Gasless route submitted but no transaction id returned.");

  return { hash, batched: true, gasless: true };
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

  try {
    const payload = {
      version: "1.0",
      chainId: CHAIN.hexId,
      from: account,
      calls,
    };

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
          return {
            hash: status.receipts[status.receipts.length - 1].transactionHash,
            batched: true,
            gasless: false,
          };
        }
        if (status?.status >= 400) throw new Error(status?.error?.message || "Batch swap failed.");
      }
      throw new Error("Batch swap timed out.");
    }
    return { hash: result, batched: true, gasless: false };
  } catch (err) {
    if (err?.code === 4001) throw err;
    return normalExecute();
  }
}

export async function executeWithGaslessOption(ctx) {
  const { tokenIn, approveAmount, swapParams, normalExecute } = ctx;
  if (!isGaslessPreferred()) return normalExecute();

  const account = getAccount();
  const calls = [];
  if (approveAmount > 0n) {
    calls.push({
      to: tokenIn.address,
      data: encodeApprove(tokenIn.address, UNISWAP.router, approveAmount),
      value: "0x0",
    });
  }
  calls.push({
    to: UNISWAP.router,
    data: encodeSwap(swapParams),
    value: "0x0",
  });

  if (gaslessSponsorActive() && sponsorConfig.policyId) {
    try {
      return await tryAlchemyGaslessSwap({
        account,
        calls,
        policyId: sponsorConfig.policyId,
      });
    } catch (err) {
      if (err?.code === 4001) throw err;
      console.warn("Alchemy gasless failed, falling back:", err);
    }
  }

  if (gaslessBatchAvailable()) {
    return tryBatchSwapCalls({ tokenIn, approveAmount, swapParams, normalExecute });
  }

  return normalExecute();
}