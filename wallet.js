import { BrowserProvider, JsonRpcProvider } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import { CHAIN } from "./network.js";

let readProvider = new JsonRpcProvider(CHAIN.rpc);
let walletProvider = null;
let signer = null;
let account = null;
let chainOk = false;

export function getReadProvider() {
  return readProvider;
}

export function resetReadProvider() {
  readProvider = new JsonRpcProvider(CHAIN.rpc);
}

export function getSigner() {
  return signer;
}

export function getAccount() {
  return account;
}

export function isConnected() {
  return Boolean(account && signer && chainOk);
}

export function hasAccount() {
  return Boolean(account && signer);
}

export function isOnCorrectChain() {
  return chainOk;
}

export function hasWallet() {
  return Boolean(window.ethereum);
}

export async function ensureChain() {
  if (!window.ethereum) throw new Error("No EVM wallet detected. Install MetaMask or similar.");
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: CHAIN.hexId,
        chainName: CHAIN.name,
        nativeCurrency: CHAIN.currency,
        rpcUrls: [CHAIN.rpc],
        blockExplorerUrls: [CHAIN.explorer],
      }],
    });
  } catch (err) {
    if (err?.code !== 4001 && err?.code !== -32602) throw err;
  }
}

export async function switchToChain() {
  if (!window.ethereum) throw new Error("No EVM wallet detected.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.hexId }],
    });
  } catch (err) {
    if (err?.code === 4902) await ensureChain();
    else if (err?.code !== 4001) throw err;
  }
}

async function verifyChainId() {
  if (!walletProvider) return false;
  const network = await walletProvider.getNetwork();
  chainOk = Number(network.chainId) === CHAIN.id;
  return chainOk;
}

export async function connect() {
  if (!window.ethereum) throw new Error("Install MetaMask or another EVM wallet.");
  await switchToChain();
  walletProvider = new BrowserProvider(window.ethereum);
  const accounts = await walletProvider.send("eth_requestAccounts", []);
  if (!accounts?.length) throw new Error("No account returned from wallet.");
  signer = await walletProvider.getSigner();
  account = accounts[0].toLowerCase();
  await verifyChainId();
  if (!chainOk) throw new Error(`Switch to ${CHAIN.name} (chain ${CHAIN.id}) in your wallet.`);
  return account;
}

export async function disconnect() {
  account = null;
  signer = null;
  walletProvider = null;
  chainOk = false;
}

export async function restoreSession() {
  if (!window.ethereum) return null;
  walletProvider = new BrowserProvider(window.ethereum);
  const accounts = await walletProvider.send("eth_accounts", []);
  if (!accounts?.length) {
    walletProvider = null;
    return null;
  }
  signer = await walletProvider.getSigner();
  account = accounts[0].toLowerCase();
  await verifyChainId();
  if (!chainOk) {
    try {
      await switchToChain();
      await verifyChainId();
    } catch {
      /* wallet may still be on the wrong chain */
    }
  }
  return account;
}

export function bindWalletEvents(onChange) {
  if (!window.ethereum?.on) return;
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts?.length) {
      await disconnect();
      onChange();
      return;
    }
    account = accounts[0].toLowerCase();
    if (walletProvider) {
      signer = await walletProvider.getSigner();
      await verifyChainId();
    }
    onChange();
  });
  window.ethereum.on("chainChanged", () => location.reload());
}

export async function handleWalletClick() {
  if (hasAccount()) {
    if (!chainOk) {
      await switchToChain();
      await verifyChainId();
      if (!chainOk) throw new Error(`Switch to ${CHAIN.name} (chain ${CHAIN.id}) in your wallet.`);
    }
    return "connected";
  }
  await connect();
  return "connected";
}