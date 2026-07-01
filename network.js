import { BRAND, NETWORKS } from "./config.js";

const STORAGE_KEY = "tickerflux-network";
const DEFAULT_KEY = "mainnet";

export let CHAIN;
export let USDG;
export let STOCKS;
export let CONTRACT;
export let LINKS;
export let AMM_TYPE;
export let UNISWAP;
export let SUPPORTS_LIQUIDITY;
export let NETWORK_KEY;
export let NETWORK_LABEL;
export let TAGLINE;

function applyNetwork(key) {
  const net = NETWORKS[key] || NETWORKS[DEFAULT_KEY];
  NETWORK_KEY = net.key;
  NETWORK_LABEL = net.label;
  CHAIN = net.chain;
  USDG = net.usdg;
  STOCKS = net.stocks;
  CONTRACT = net.contract;
  LINKS = net.links;
  AMM_TYPE = net.ammType;
  UNISWAP = net.uniswap || null;
  SUPPORTS_LIQUIDITY = Boolean(net.supportsLiquidity);
  TAGLINE = net.tagline;
}

export function getBrand() {
  return { ...BRAND, tagline: TAGLINE };
}

export function isMainnet() {
  return NETWORK_KEY === "mainnet";
}

export function isTestnet() {
  return NETWORK_KEY === "testnet";
}

export function isCustomAmm() {
  return AMM_TYPE === "custom";
}

export function isUniswapAmm() {
  return AMM_TYPE === "uniswap-v3";
}

export function getNetworkKeys() {
  return Object.keys(NETWORKS);
}

export function getActiveNetworkKey() {
  return NETWORK_KEY;
}

export function setActiveNetworkKey(key) {
  if (!NETWORKS[key] || key === NETWORK_KEY) return false;
  localStorage.setItem(STORAGE_KEY, key);
  location.reload();
  return true;
}

const stored = localStorage.getItem(STORAGE_KEY);
applyNetwork(NETWORKS[stored] ? stored : DEFAULT_KEY);