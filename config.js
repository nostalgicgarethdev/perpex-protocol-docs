export const BRAND = {
  name: "TickerFlux",
  short: "TF",
  headline: "Route between tickers and USDG.",
  description:
    "The Robinhood Chain trading terminal — route intel, pinned lanes, live ticker, portfolio book, and mainnet swaps. More than a swap box.",
  url: "https://tickerflux-vercel.vercel.app",
  fee: "0.3%",
  tokenCa: "HXqPR3T1oG9sUrTTmGjSrEPjDeUBMcvzjt1iMMp9pump",
  tokenCaUrl: "https://pump.fun/coin/HXqPR3T1oG9sUrTTmGjSrEPjDeUBMcvzjt1iMMp9pump",
};

export const QUICK_BUY_AMOUNTS = [10, 50, 100, 500];

export const VS_HOODSWAP = [
  { label: "Mainnet swaps", us: true, them: false },
  { label: "Route intel (impact + min out)", us: true, them: false },
  { label: "Lane pulse dashboard", us: true, them: false },
  { label: "Portfolio book", us: true, them: false },
  { label: "Live on-chain feed", us: true, them: false },
  { label: "Slippage controls", us: true, them: false },
  { label: "Pin favorite lanes", us: true, them: false },
  { label: "Shareable deep links", us: true, them: false },
  { label: "24h lane volume", us: true, them: false },
  { label: "Share route cards", us: true, them: false },
  { label: "Gas saver / gasless batch", us: true, them: false },
  { label: "12+ mainnet tickers", us: true, them: false },
];

export const SLIPPAGE_BPS = 50;
export const FEE_BPS = 30;
export const SLIPPAGE_OPTIONS = [10, 50, 100, 200];

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

export const UNISWAP_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
];

export const UNISWAP_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

export const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

export const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

const STOCK_HUES = {
  TSLA: "#ef4444",
  AMZN: "#f59e0b",
  PLTR: "#22d3ee",
  NFLX: "#ef4444",
  NVDA: "#76b900",
  AMD: "#22c55e",
  AAPL: "#94a3b8",
  GOOGL: "#4285f4",
  META: "#1877f2",
  MSFT: "#00a4ef",
  SPY: "#8b5cf6",
  QQQ: "#a855f7",
  COIN: "#2563eb",
};

export const NETWORKS = {
  mainnet: {
    key: "mainnet",
    label: "Mainnet",
    chain: {
      id: 4663,
      hexId: "0x1237",
      name: "Robinhood Chain",
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      explorer: "https://robinhoodchain.blockscout.com",
      currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    tagline: "Isolated equity lanes on Robinhood Chain mainnet.",
    ammType: "uniswap-v3",
    uniswap: {
      factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
      quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
      router: "0xcaf681a66d020601342297493863e78c959e5cb2",
      feeTiers: [500, 3000, 10000],
    },
    contract: {
      address: "0xcaf681a66d020601342297493863e78c959e5cb2",
      label: "Uniswap SwapRouter02",
    },
    usdg: {
      symbol: "USDG",
      name: "USDG Stablecoin",
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      decimals: 18,
      isStable: true,
    },
    stocks: [
      { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, hue: STOCK_HUES.TSLA },
      { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, hue: STOCK_HUES.NVDA },
      { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, hue: STOCK_HUES.AAPL },
      { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, hue: STOCK_HUES.AMZN },
      { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, hue: STOCK_HUES.GOOGL },
      { symbol: "META", name: "Meta", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, hue: STOCK_HUES.META },
      { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, hue: STOCK_HUES.MSFT },
      { symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, hue: STOCK_HUES.AMD },
      { symbol: "PLTR", name: "Palantir", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", decimals: 18, hue: STOCK_HUES.PLTR },
      { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, hue: STOCK_HUES.COIN },
      { symbol: "SPY", name: "S&P 500 ETF", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, hue: STOCK_HUES.SPY },
      { symbol: "QQQ", name: "Nasdaq 100 ETF", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", decimals: 18, hue: STOCK_HUES.QQQ },
    ],
    links: {
      bridge: "https://docs.robinhood.com/chain/bridging",
      chainDocs: "https://docs.robinhood.com/chain/",
      uniswap: "https://app.uniswap.org",
    },
    supportsLiquidity: false,
  },
  testnet: {
    key: "testnet",
    label: "Testnet",
    chain: {
      id: 46630,
      hexId: "0xb63e",
      name: "Robinhood Chain Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      explorer: "https://explorer.testnet.chain.robinhood.com",
      currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    tagline: "Isolated equity lanes on Robinhood Chain testnet.",
    ammType: "custom",
    contract: {
      address: "0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe",
      deployTx: "0xf2c85f81738ea12cc54f4c193514b6b9914ac03fa974695993b033c3c9f8b88a",
      deployer: "0x4378C8691Cb661c6Dc6eCdfF045fc6851A8aF562",
      label: "TickerFlux AMM",
    },
    usdg: {
      symbol: "USDG",
      name: "USDG Stablecoin",
      address: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
      decimals: 18,
      isStable: true,
    },
    stocks: [
      { symbol: "TSLA", name: "Tesla", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", decimals: 18, hue: STOCK_HUES.TSLA },
      { symbol: "AMZN", name: "Amazon", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", decimals: 18, hue: STOCK_HUES.AMZN },
      { symbol: "PLTR", name: "Palantir", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", decimals: 18, hue: STOCK_HUES.PLTR },
      { symbol: "NFLX", name: "Netflix", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", decimals: 18, hue: STOCK_HUES.NFLX },
      { symbol: "AMD", name: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d", decimals: 18, hue: STOCK_HUES.AMD },
    ],
    links: {
      ethFaucet: "https://faucet.testnet.chain.robinhood.com/",
      paxosFaucet: "https://faucet.paxos.com/?network=robinhood",
      chainDocs: "https://docs.robinhood.com/chain/",
    },
    supportsLiquidity: true,
  },
};