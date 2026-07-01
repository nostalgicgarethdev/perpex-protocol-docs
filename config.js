export const CHAIN = {
  id: 46630,
  hexId: "0xb63e",
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const BRAND = {
  name: "Perpex",
  tagline: "Tokenized equities, swapped onchain.",
};

export const CONTRACT = {
  address: "0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe",
  deployTx: "0xf2c85f81738ea12cc54f4c193514b6b9914ac03fa974695993b033c3c9f8b88a",
  deployer: "0x4378C8691Cb661c6Dc6eCdfF045fc6851A8aF562",
};

export const USDG = {
  symbol: "USDG",
  name: "USDG Stablecoin",
  address: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
  decimals: 18,
  isStable: true,
};

export const STOCKS = [
  { symbol: "TSLA", name: "Tesla", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", decimals: 18 },
  { symbol: "AMZN", name: "Amazon", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", decimals: 18 },
  { symbol: "PLTR", name: "Palantir", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", decimals: 18 },
  { symbol: "NFLX", name: "Netflix", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", decimals: 18 },
  { symbol: "AMD", name: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d", decimals: 18 },
];

export const LINKS = {
  ethFaucet: "https://faucet.testnet.chain.robinhood.com/",
  paxosFaucet: "https://faucet.paxos.com/?network=robinhood",
  chainDocs: "https://docs.robinhood.com/chain/",
};

export const SLIPPAGE_BPS = 50;

export const SWAP_ABI = [
  "function getPool(address stock) view returns (uint112 reserveStock, uint112 reserveUsdg)",
  "function getAmountOut(address stock, address tokenIn, uint256 amountIn) view returns (uint256)",
  "function swap(address stock, address tokenIn, uint256 amountIn, uint256 minAmountOut) returns (uint256 amountOut)",
  "function addLiquidity(address stock, uint256 stockAmount, uint256 usdgAmount)",
  "event Swap(address indexed stock, address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];