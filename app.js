import { Contract, formatUnits, parseUnits } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import {
  BRAND,
  CHAIN,
  CONTRACT,
  USDG,
  STOCKS,
  LINKS,
  SLIPPAGE_BPS,
  FEE_BPS,
  SLIPPAGE_OPTIONS,
  SWAP_ABI,
  ERC20_ABI,
} from "./config.js";
import {
  getReadProvider,
  getSigner,
  getAccount,
  isConnected,
  hasAccount,
  isOnCorrectChain,
  hasWallet,
  ensureChain,
  disconnect,
  restoreSession,
  bindWalletEvents,
  handleWalletClick,
} from "./wallet.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  stock: STOCKS[0],
  mode: "buy",
  amountIn: "",
  amountOut: "",
  pool: [0n, 0n],
  allPools: {},
  balances: {},
  slippage: SLIPPAGE_BPS,
  busy: false,
  liqOpen: false,
  terminalTab: "exchange",
  liqStock: "",
  liqUsdg: "",
  flash: null,
  walletBusy: false,
  activity: [],
  activityLoading: false,
  myTrades: [],
};

let poolPollTimer = null;

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

function fmt(amount, decimals, digits = 4) {
  if (amount === undefined || amount === null) return "—";
  const n = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const base = raw.split("?")[0];
  const path = base.startsWith("/") ? base : `/${base}`;
  if (path === "/liquidity") {
    state.liqOpen = true;
    state.terminalTab = "deposit";
  }
  return path;
}

function applyHashParams() {
  const hash = location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const stock = params.get("stock");
  const mode = params.get("mode");
  const tab = params.get("tab");
  if (stock) state.stock = STOCKS.find((s) => s.symbol === stock.toUpperCase()) || state.stock;
  if (mode === "buy" || mode === "sell") state.mode = mode;
  if (tab === "deposit") {
    state.terminalTab = "deposit";
    state.liqOpen = true;
  } else if (tab === "exchange") {
    state.terminalTab = "exchange";
    state.liqOpen = false;
  }
}

function syncHashParams() {
  const path = route();
  if (path !== "/" && path !== "/liquidity") return;
  const params = new URLSearchParams();
  params.set("stock", state.stock.symbol);
  params.set("mode", state.mode);
  params.set("tab", state.terminalTab);
  const target = `#/?${params}`;
  if (location.hash !== target) history.replaceState(null, "", target);
}

function setFlash(type, msg) {
  state.flash = msg ? { type, msg } : null;
  render();
  if (msg) {
    setTimeout(() => {
      if (state.flash?.msg === msg) {
        state.flash = null;
        render();
      }
    }, 7000);
  }
}

function swapContract(writable = false) {
  const signer = writable ? getSigner() : null;
  return new Contract(CONTRACT.address, SWAP_ABI, signer || getReadProvider());
}

function erc20(token, writable = false) {
  const signer = writable ? getSigner() : null;
  return new Contract(token.address, ERC20_ABI, signer || getReadProvider());
}

async function refreshPool(symbol = state.stock.symbol) {
  const stock = STOCKS.find((s) => s.symbol === symbol) || state.stock;
  try {
    const pool = await swapContract().getPool(stock.address);
    const reserves = [pool.reserveStock ?? pool[0], pool.reserveUsdg ?? pool[1]];
    state.allPools[symbol] = reserves;
    if (symbol === state.stock.symbol) state.pool = reserves;
  } catch {
    state.allPools[symbol] = [0n, 0n];
    if (symbol === state.stock.symbol) state.pool = [0n, 0n];
  }
}

async function refreshAllPools() {
  await Promise.all(STOCKS.map((s) => refreshPool(s.symbol)));
}

async function refreshBalances() {
  const account = getAccount();
  if (!account) return;
  const entries = await Promise.all(
    [...STOCKS, USDG].map(async (t) => {
      try {
        const bal = await erc20(t).balanceOf(account);
        return [t.address.toLowerCase(), bal];
      } catch {
        return [t.address.toLowerCase(), 0n];
      }
    })
  );
  state.balances = Object.fromEntries(entries);
}

async function refreshQuote() {
  if (!state.amountIn || Number(state.amountIn) <= 0) {
    state.amountOut = "";
    return;
  }
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  try {
    const rawIn = parseUnits(state.amountIn, tokenIn.decimals);
    const out = await swapContract().getAmountOut(state.stock.address, tokenIn.address, rawIn);
    const tokenOut = state.mode === "buy" ? state.stock : USDG;
    state.amountOut = formatUnits(out, tokenOut.decimals);
  } catch {
    state.amountOut = "";
  }
}

async function approveIfNeeded(token, amount) {
  const account = getAccount();
  const c = erc20(token, true);
  const allowance = await c.allowance(account, CONTRACT.address);
  if (allowance >= amount) return;
  setFlash("ok", `Approve ${token.symbol} in your wallet…`);
  const tx = await c.approve(CONTRACT.address, amount);
  await tx.wait();
}

async function onConnectClick() {
  if (state.walletBusy) return;
  if (hasAccount() && isOnCorrectChain()) return;
  state.walletBusy = true;
  render();
  try {
    await handleWalletClick();
    await refreshBalances();
    await refreshAllPools();
    await refreshActivity();
    await refreshQuote();
    setFlash("ok", isOnCorrectChain() ? "Wallet ready on Robinhood testnet." : "Connected — switch to Robinhood testnet.");
  } catch (err) {
    setFlash("err", err?.shortMessage || err?.message || "Wallet error.");
  } finally {
    state.walletBusy = false;
    render();
  }
}

async function executeSwap() {
  if (!isConnected()) return onConnectClick();
  if (!state.amountIn || Number(state.amountIn) <= 0) return;
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  const tokenOut = state.mode === "buy" ? state.stock : USDG;
  const rawIn = parseUnits(state.amountIn, tokenIn.decimals);
  const bal = state.balances[tokenIn.address.toLowerCase()] ?? 0n;
  if (bal < rawIn) {
    setFlash("err", `Insufficient ${tokenIn.symbol} balance.`);
    return;
  }
  if (state.pool[0] === 0n && state.pool[1] === 0n) {
    setFlash("err", "Pool is empty — add liquidity first.");
    return;
  }

  state.busy = true;
  render();
  try {
    const quoted = await swapContract().getAmountOut(state.stock.address, tokenIn.address, rawIn);
    const minOut = (quoted * BigInt(10000 - state.slippage)) / 10000n;
    await approveIfNeeded(tokenIn, rawIn);
    setFlash("ok", "Confirm swap in your wallet…");
    const tx = await swapContract(true).swap(
      state.stock.address,
      tokenIn.address,
      rawIn,
      minOut
    );
    await tx.wait();
    state.amountIn = "";
    state.amountOut = "";
    await refreshBalances();
    await refreshPool();
    await refreshActivity();
    setFlash("ok", `Swapped ${tokenIn.symbol} → ${tokenOut.symbol}.`);
  } catch (err) {
    setFlash("err", err?.shortMessage || err?.reason || err?.message || "Swap failed.");
  } finally {
    state.busy = false;
    render();
  }
}

async function executeLiquidity() {
  if (!isConnected()) return onConnectClick();
  if (!state.liqStock || !state.liqUsdg) return;
  const stockAmt = parseUnits(state.liqStock, state.stock.decimals);
  const usdgAmt = parseUnits(state.liqUsdg, USDG.decimals);
  const stockBal = state.balances[state.stock.address.toLowerCase()] ?? 0n;
  const usdgBal = state.balances[USDG.address.toLowerCase()] ?? 0n;
  if (stockBal < stockAmt) {
    setFlash("err", `Insufficient ${state.stock.symbol} balance.`);
    return;
  }
  if (usdgBal < usdgAmt) {
    setFlash("err", "Insufficient USDG balance.");
    return;
  }
  state.busy = true;
  render();
  try {
    await approveIfNeeded(state.stock, stockAmt);
    await approveIfNeeded(USDG, usdgAmt);
    setFlash("ok", "Confirm liquidity deposit in your wallet…");
    const tx = await swapContract(true).addLiquidity(
      state.stock.address,
      stockAmt,
      usdgAmt
    );
    await tx.wait();
    state.liqStock = "";
    state.liqUsdg = "";
    await refreshBalances();
    await refreshAllPools();
    await refreshActivity();
    setFlash("ok", "Liquidity added.");
  } catch (err) {
    setFlash("err", err?.shortMessage || err?.reason || err?.message || "Liquidity failed.");
  } finally {
    state.busy = false;
    render();
  }
}

function swapButtonLabel() {
  if (state.walletBusy) return "Connecting…";
  if (!isConnected()) return "Connect wallet";
  if (!state.amountIn || Number(state.amountIn) <= 0) return "Enter amount";
  if (state.busy) return "Processing…";
  if (state.pool[0] === 0n && state.pool[1] === 0n) return "Pool empty";
  if (!isOnCorrectChain() && hasAccount()) return "Switch network";
  return state.mode === "buy" ? `Route USDG → ${state.stock.symbol}` : `Route ${state.stock.symbol} → USDG`;
}

function poolEmpty(pool = state.pool) {
  return pool[0] === 0n && pool[1] === 0n;
}

function countLivePools() {
  return STOCKS.filter((s) => !poolEmpty(state.allPools[s.symbol] || [0n, 0n])).length;
}

function poolDepthPct(pool = state.pool) {
  const total = Number(pool[0]) + Number(pool[1]);
  if (!total) return 0;
  return Math.min(100, Math.round((Number(pool[1]) / total) * 100));
}

function midPrice(pool, stock) {
  if (!pool || pool[0] === 0n) return null;
  const stockAmt = Number(formatUnits(pool[0], stock.decimals));
  const usdgAmt = Number(formatUnits(pool[1], USDG.decimals));
  if (!stockAmt) return null;
  return usdgAmt / stockAmt;
}

function spotOutRaw(amountInRaw, reserveIn, reserveOut) {
  if (!amountInRaw || reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInWithFee = (amountInRaw * BigInt(10000 - FEE_BPS)) / 10000n;
  return (amountInWithFee * reserveOut) / reserveIn;
}

function priceImpactPct(amountInRaw, amountOutRaw, reserveIn, reserveOut) {
  const spot = spotOutRaw(amountInRaw, reserveIn, reserveOut);
  if (!spot || amountOutRaw === 0n) return 0;
  const impact = ((Number(spot) - Number(amountOutRaw)) / Number(spot)) * 100;
  return Math.max(0, Math.min(99.9, impact));
}

function laneHealth(pool) {
  if (poolEmpty(pool)) return 0;
  const usdg = Number(formatUnits(pool[1], USDG.decimals));
  return Math.min(100, Math.round(Math.sqrt(Math.max(usdg, 1)) * 8));
}

function deepestLane() {
  let best = null;
  let bestUsdg = 0;
  for (const s of STOCKS) {
    const pool = state.allPools[s.symbol] || [0n, 0n];
    if (poolEmpty(pool)) continue;
    const usdg = Number(formatUnits(pool[1], USDG.decimals));
    if (usdg > bestUsdg) {
      bestUsdg = usdg;
      best = s;
    }
  }
  return best ? { stock: best, usdg: bestUsdg } : null;
}

function routeIntel() {
  const empty = poolEmpty();
  const price = midPrice(state.pool, state.stock);
  if (empty || !state.amountIn || Number(state.amountIn) <= 0 || !state.amountOut) {
    return {
      empty,
      price,
      impact: 0,
      minOut: null,
      rate: null,
      feeEst: null,
    };
  }
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  const tokenOut = state.mode === "buy" ? state.stock : USDG;
  const rawIn = parseUnits(state.amountIn, tokenIn.decimals);
  const rawOut = parseUnits(state.amountOut, tokenOut.decimals);
  const reserveIn = state.mode === "buy" ? state.pool[1] : state.pool[0];
  const reserveOut = state.mode === "buy" ? state.pool[0] : state.pool[1];
  const impact = priceImpactPct(rawIn, rawOut, reserveIn, reserveOut);
  const minOut = (rawOut * BigInt(10000 - state.slippage)) / 10000n;
  const feeEst = (rawIn * BigInt(FEE_BPS)) / 10000n;
  const inNum = Number(state.amountIn);
  const outNum = Number(state.amountOut);
  const rate = inNum > 0 ? outNum / inNum : null;
  return { empty, price, impact, minOut, rate, feeEst, tokenIn, tokenOut };
}

function portfolioSummary() {
  const account = getAccount();
  if (!account) return null;
  const usdgBal = state.balances[USDG.address.toLowerCase()] ?? 0n;
  let equityUsd = 0;
  const holdings = STOCKS.map((s) => {
    const bal = state.balances[s.address.toLowerCase()] ?? 0n;
    const pool = state.allPools[s.symbol] || [0n, 0n];
    const price = midPrice(pool, s);
    const qty = Number(formatUnits(bal, s.decimals));
    const usd = price ? qty * price : 0;
    equityUsd += usd;
    return { stock: s, bal, qty, usd, price };
  }).filter((h) => h.bal > 0n);
  const usdg = Number(formatUnits(usdgBal, USDG.decimals));
  return {
    holdings,
    usdg,
    equityUsd,
    totalUsd: usdg + equityUsd,
  };
}

async function refreshActivity() {
  state.activityLoading = true;
  try {
    const contract = swapContract();
    const latest = await getReadProvider().getBlockNumber();
    const from = Math.max(0, latest - 12000);
    const events = await contract.queryFilter(contract.filters.Swap(), from, latest);
    const account = getAccount()?.toLowerCase();
    const parsed = events.slice(-40).reverse().map((ev) => {
      const stock = STOCKS.find((s) => s.address.toLowerCase() === ev.args.stock.toLowerCase());
      const tokenInAddr = ev.args.tokenIn.toLowerCase();
      const isUsdgIn = tokenInAddr === USDG.address.toLowerCase();
      return {
        stock,
        user: ev.args.user,
        side: isUsdgIn ? "buy" : "sell",
        amountIn: ev.args.amountIn,
        amountOut: ev.args.amountOut,
        tokenIn: isUsdgIn ? USDG : stock,
        tokenOut: isUsdgIn ? stock : USDG,
        tx: ev.transactionHash,
        block: ev.blockNumber,
        mine: account && ev.args.user.toLowerCase() === account,
      };
    });
    state.activity = parsed.slice(0, 12);
    state.myTrades = parsed.filter((e) => e.mine).slice(0, 6);
  } catch {
    state.activity = [];
    state.myTrades = [];
  } finally {
    state.activityLoading = false;
  }
}

const NAV = [
  { href: "/", label: "Terminal", match: (p) => p === "/" || p === "/liquidity" },
  { href: "/pools", label: "Reserves", match: (p) => p === "/pools" },
  { href: "/faucet", label: "Faucet", match: (p) => p === "/faucet" },
  { href: "/docs", label: "Docs", match: (p) => p.startsWith("/docs") },
  { href: "/explorer", label: "Explorer", match: (p) => p === "/explorer" },
  { href: "/roadmap", label: "Roadmap", match: (p) => p === "/roadmap" },
];

function chainBannerHtml() {
  if (!hasAccount() || isOnCorrectChain()) return "";
  return `
    <div class="chain-banner" role="status">
      <span>Wrong network — switch to ${CHAIN.name} (chain ${CHAIN.id}) to sign transactions.</span>
      <button class="btn-text" id="switch-chain">Switch network</button>
    </div>
  `;
}

function renderShell(content) {
  const path = route();
  const account = getAccount();

  $("#app").innerHTML = `
    <div class="app">
      <div class="ambient" aria-hidden="true">
        <div class="aurora"></div>
        <div class="glass-blob glass-blob-a"></div>
        <div class="glass-blob glass-blob-b"></div>
        <div class="glass-blob glass-blob-c"></div>
        <div class="stars"></div>
        <div class="mist"></div>
        <div class="noise"></div>
      </div>
      ${chainBannerHtml()}
      <header class="topbar liquid-glass-nav" id="topbar">
        <a href="#/" class="brand">
          <span class="brand-mark"><img src="/assets/logo-mark.svg" alt="" width="22" height="22" /></span>
          <span>${BRAND.name}</span>
        </a>
        <nav class="topnav">
          ${NAV.map((n) => `<a href="#${n.href}" class="topnav-link ${n.match(path) ? "active" : ""}">${n.label}</a>`).join("")}
        </nav>
        <div class="topbar-end">
          <span class="chain-pill">RH · ${CHAIN.id}</span>
          <button class="wallet-btn ${hasAccount() && isOnCorrectChain() ? "on" : ""}" id="connect-btn" ${state.walletBusy ? "disabled" : ""}>
            ${state.walletBusy ? "…" : hasAccount() ? shortAddr(account) : "Connect"}
          </button>
        </div>
      </header>
      <main class="page page-enter">${content}</main>
      <footer class="page-foot liquid-glass-subtle">
        <span>${BRAND.name} · ${BRAND.tagline}</span>
        <span class="page-foot-links">
          <a href="${BRAND.url}">${BRAND.url.replace("https://", "")}</a>
          <a href="#/pools">Reserves</a>
          <a href="#/faucet">Faucet</a>
          <a href="${CHAIN.explorer}" target="_blank" rel="noreferrer">Block explorer</a>
        </span>
      </footer>
    </div>
  `;

  $("#connect-btn")?.addEventListener("click", onConnectClick);
  $("#switch-chain")?.addEventListener("click", onConnectClick);
  bindTopbarScroll();
}

function bindTopbarScroll() {
  const topbar = document.getElementById("topbar");
  if (!topbar) return;
  const onScroll = () => topbar.classList.toggle("topbar-scrolled", window.scrollY > 20);
  window.removeEventListener("scroll", topbar._scrollFn);
  topbar._scrollFn = onScroll;
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function laneRailHtml() {
  return STOCKS.map((s) => {
    const pool = state.allPools[s.symbol] || [0n, 0n];
    const active = s.symbol === state.stock.symbol;
    const empty = poolEmpty(pool);
    const price = midPrice(pool, s);
    return `
      <button class="lane-btn liquid-glass-hover ${active ? "active" : ""}" data-stock="${s.symbol}" type="button">
        <span class="lane-dot" style="background:${s.hue}"></span>
        <span class="lane-sym">${s.symbol}</span>
        <span class="lane-meta">${empty ? "Unseeded" : price ? `$${price.toFixed(2)}` : "—"}</span>
        <span class="lane-depth">${empty ? "" : `${fmt(pool[1], USDG.decimals, 0)} USDG`}</span>
      </button>
    `;
  }).join("");
}

function slippageHtml() {
  return SLIPPAGE_OPTIONS.map((bps) =>
    `<button class="slip-pill ${state.slippage === bps ? "active" : ""}" data-slip="${bps}" type="button">${(bps / 100).toFixed(bps < 100 ? 1 : 0)}%</button>`
  ).join("");
}

function routeIntelHtml() {
  const intel = routeIntel();
  const impactClass = intel.impact >= 5 ? "impact-high" : intel.impact >= 2 ? "impact-mid" : "";
  if (intel.empty) {
    return `<div class="route-intel liquid-glass-inset"><p class="route-intel-empty">Route intel unlocks once this lane is seeded.</p></div>`;
  }
  return `
    <div class="route-intel liquid-glass-inset">
      <div class="route-intel-head">
        <h3>Route intel</h3>
        <span class="route-intel-tag">TickerFlux extra</span>
      </div>
      <div class="route-intel-grid">
        <div><span>Mid price</span><strong>${intel.price ? `$${intel.price.toFixed(2)}` : "—"}</strong></div>
        <div><span>Price impact</span><strong class="${impactClass}">${intel.impact ? `${intel.impact.toFixed(2)}%` : "—"}</strong></div>
        <div><span>Min received</span><strong>${intel.minOut ? fmt(intel.minOut, intel.tokenOut.decimals, 4) : "—"} ${intel.minOut ? intel.tokenOut.symbol : ""}</strong></div>
        <div><span>Route fee (~)</span><strong>${intel.feeEst ? fmt(intel.feeEst, intel.tokenIn.decimals, 4) : "—"} ${intel.feeEst ? intel.tokenIn.symbol : ""}</strong></div>
      </div>
      ${intel.impact >= 3 ? `<p class="route-intel-warn">High impact — consider a smaller size or a deeper lane.</p>` : ""}
    </div>
  `;
}

function portfolioBarHtml() {
  const pf = portfolioSummary();
  if (!pf || (!pf.holdings.length && pf.usdg === 0)) return "";
  const chips = pf.holdings.map((h) =>
    `<span class="pf-chip"><span class="lane-dot" style="background:${h.stock.hue}"></span>${h.stock.symbol} <strong>${h.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></span>`
  ).join("");
  return `
    <section class="portfolio-bar liquid-glass">
      <div class="portfolio-head">
        <h3>Your book</h3>
        <strong class="portfolio-total">~$${pf.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
      </div>
      <div class="portfolio-chips">
        <span class="pf-chip pf-usdg">USDG <strong>${pf.usdg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span>
        ${chips}
      </div>
    </section>
  `;
}

function lanePulseHtml() {
  const rows = STOCKS.map((s) => {
    const pool = state.allPools[s.symbol] || [0n, 0n];
    const empty = poolEmpty(pool);
    const price = midPrice(pool, s);
    const health = laneHealth(pool);
    const active = s.symbol === state.stock.symbol;
    return `
      <tr class="${active ? "pulse-active" : ""}">
        <td><span class="lane-dot" style="background:${s.hue}"></span>${s.symbol}</td>
        <td>${empty ? "—" : price ? `$${price.toFixed(2)}` : "—"}</td>
        <td>${empty ? "—" : fmt(pool[1], USDG.decimals, 0)}</td>
        <td><span class="health-bar"><span style="width:${health}%"></span></span> ${empty ? "—" : health}</td>
        <td><button class="btn-text" data-stock="${s.symbol}" type="button">${active ? "Selected" : "Open"}</button></td>
      </tr>
    `;
  }).join("");
  const deep = deepestLane();
  return `
    <section class="lane-pulse liquid-glass">
      <div class="lane-pulse-head">
        <div>
          <h3>Lane pulse</h3>
          <p>Compare every ticker lane — price, depth, and health at a glance.</p>
        </div>
        ${deep ? `<span class="pulse-hint">Deepest lane: <strong>${deep.stock.symbol}</strong> (${deep.usdg.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDG)</span>` : ""}
      </div>
      <table class="pulse-table">
        <thead><tr><th>Ticker</th><th>Mid</th><th>USDG depth</th><th>Health</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function activityRowHtml(ev) {
  const sym = ev.stock?.symbol || "?";
  const inSym = ev.tokenIn?.symbol || "?";
  const outSym = ev.tokenOut?.symbol || "?";
  return `
    <div class="activity-row ${ev.mine ? "mine" : ""}">
      <div class="activity-main">
        <span class="activity-side ${ev.side}">${ev.side === "buy" ? "IN" : "OUT"}</span>
        <span><strong>${sym}</strong> · ${fmt(ev.amountIn, ev.tokenIn.decimals, 3)} ${inSym} → ${fmt(ev.amountOut, ev.tokenOut.decimals, 3)} ${outSym}</span>
      </div>
      <a class="activity-tx mono" href="${CHAIN.explorer}/tx/${ev.tx}" target="_blank" rel="noreferrer">${shortAddr(ev.tx)}</a>
    </div>
  `;
}

function activityFeedHtml() {
  const mine = state.myTrades;
  const feed = state.activity;
  return `
    <section class="activity-feed liquid-glass">
      <div class="activity-head">
        <h3>Live route feed</h3>
        <p>Recent swaps pulled live from the AMM contract.</p>
      </div>
      ${hasAccount() && mine.length ? `
        <div class="activity-block">
          <h4>Your routes</h4>
          ${mine.map(activityRowHtml).join("")}
        </div>` : ""}
      <div class="activity-block">
        <h4>${state.activityLoading ? "Loading…" : "All lanes"}</h4>
        ${feed.length ? feed.map(activityRowHtml).join("") : `<p class="activity-empty">No recent swaps yet — seed a lane and be the first.</p>`}
      </div>
    </section>
  `;
}

function setupStripHtml(account) {
  if (account && isOnCorrectChain()) {
    return `
      <div class="setup-strip liquid-glass-inset">
        <span class="mono">Signed in as ${shortAddr(account)}</span>
        <button class="btn-text" id="disconnect-btn" type="button">Disconnect</button>
      </div>
    `;
  }
  return `
    <div class="setup-strip liquid-glass-inset">
      <p>Add Robinhood testnet, claim ETH + USDG, then connect your wallet.</p>
      <div class="setup-strip-actions">
        <button class="btn-secondary inline" id="add-network" type="button">Add network</button>
        <a href="#/faucet" class="btn-text">Faucet guide</a>
      </div>
      ${!hasWallet() ? `<p class="setup-warn">No wallet extension detected.</p>` : ""}
    </div>
  `;
}

function renderHome() {
  const account = getAccount();
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  const tokenOut = state.mode === "buy" ? state.stock : USDG;
  const balIn = state.balances[tokenIn.address.toLowerCase()];
  const empty = poolEmpty();
  const tab = state.liqOpen ? "deposit" : state.terminalTab;
  const deep = deepestLane();

  renderShell(`
    <section class="page-hero-compact">
      <div class="page-hero-copy">
        <p class="hero-eyebrow liquid-glass-pill"><span class="tag-dot"></span>${CHAIN.name}</p>
        <h1 class="page-hero-title">${BRAND.headline}</h1>
        <p class="page-hero-lead">${BRAND.description}</p>
      </div>
      <div class="hero-stat-grid liquid-glass">
        <div class="hero-stat"><span>Lanes</span><strong>${STOCKS.length}</strong></div>
        <div class="hero-stat"><span>Seeded</span><strong>${countLivePools()}</strong></div>
        <div class="hero-stat"><span>Route fee</span><strong>${BRAND.fee}</strong></div>
        <div class="hero-stat"><span>Chain</span><strong>${CHAIN.id}</strong></div>
      </div>
    </section>

    ${portfolioBarHtml()}

    ${deep && deep.stock.symbol !== state.stock.symbol && state.mode === "buy" ? `
    <div class="smart-hint liquid-glass-inset">
      <span>Deeper liquidity in <strong>${deep.stock.symbol}</strong> (${deep.usdg.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDG)</span>
      <button class="btn-text" data-stock="${deep.stock.symbol}" type="button">Switch lane</button>
    </div>` : ""}

    <section class="trade-terminal liquid-glass" id="trade">
      <div class="terminal-head">
        <div>
          <h2>Exchange terminal</h2>
          <p>${state.stock.name} lane · ${state.stock.symbol} / USDG · ${BRAND.fee} route fee</p>
        </div>
        <div class="terminal-tabs" role="tablist">
          <button class="terminal-tab ${tab === "exchange" ? "active" : ""}" data-tab="exchange" type="button">Exchange</button>
          <button class="terminal-tab ${tab === "deposit" ? "active" : ""}" data-tab="deposit" type="button">Deposit</button>
        </div>
      </div>

      <div class="terminal-body">
        <nav class="lane-rail" aria-label="Ticker lanes">${laneRailHtml()}</nav>

        <div class="terminal-panel">
          ${tab === "exchange" ? `
          <div class="flow-switch">
            <button class="flow-btn ${state.mode === "buy" ? "active" : ""}" data-mode="buy" type="button">USDG → ${state.stock.symbol}</button>
            <button class="flow-btn ${state.mode === "sell" ? "active" : ""}" data-mode="sell" type="button">${state.stock.symbol} → USDG</button>
          </div>

          <div class="field">
            <div class="field-top">
              <label>Send</label>
              ${balIn !== undefined && account ? `<button class="field-max" data-max="in" type="button">Max ${fmt(balIn, tokenIn.decimals, 2)}</button>` : ""}
            </div>
            <div class="field-row">
              <input id="amount-in" type="text" inputmode="decimal" placeholder="0.00" value="${state.amountIn}" />
              <span class="field-token">${tokenIn.symbol}</span>
            </div>
          </div>

          <div class="swap-divider"><span class="swap-arrow" aria-hidden="true"></span></div>

          <div class="field">
            <div class="field-top"><label>Receive (estimated)</label></div>
            <div class="field-row">
              <input class="readonly" readonly placeholder="0.00" value="${state.amountOut ? Number(state.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 }) : ""}" />
              <span class="field-token">${tokenOut.symbol}</span>
            </div>
          </div>

          ${routeIntelHtml()}

          <div class="slippage-row">
            <span>Slippage guard</span>
            <div class="slippage-pills">${slippageHtml()}</div>
          </div>

          ${empty ? `
          <div class="notice">
            <strong>Lane unseeded.</strong> Deposit ${state.stock.symbol} + USDG before routing trades.
            <button class="btn-text" id="jump-liq" type="button">Open deposit tab</button>
          </div>` : ""}

          <button class="btn-primary" id="swap-btn" type="button" ${state.busy || state.walletBusy || empty ? "disabled" : ""}>
            ${swapButtonLabel()}
          </button>
          ` : `
          <p class="terminal-copy">${empty
            ? `Seed the ${state.stock.symbol} lane with both assets. Example: 0.1 ${state.stock.symbol} + 10 USDG.`
            : `Add ${state.stock.symbol} and USDG to deepen this lane's reserves.`}</p>
          ${empty ? `<p class="terminal-copy"><a href="#/faucet">Get test ETH and USDG</a> before depositing.</p>` : ""}
          <div class="liq-fields">
            <label>${state.stock.symbol}<input id="liq-stock" type="text" inputmode="decimal" placeholder="0.1" value="${state.liqStock}" /></label>
            <label>USDG<input id="liq-usdg" type="text" inputmode="decimal" placeholder="10" value="${state.liqUsdg}" /></label>
          </div>
          <button class="btn-primary" id="liq-btn" type="button" ${state.busy || state.walletBusy ? "disabled" : ""}>
            ${!isConnected() ? "Connect wallet" : state.busy ? "Processing…" : `Deposit into ${state.stock.symbol} lane`}
          </button>
          `}

          ${state.flash ? `<div class="toast ${state.flash.type}">${state.flash.msg}</div>` : ""}
        </div>
      </div>

      <div class="reserve-strip liquid-glass-inset">
        <div><span>${state.stock.symbol} reserve</span><strong>${fmt(state.pool[0], state.stock.decimals, 2)}</strong></div>
        <div><span>USDG reserve</span><strong>${fmt(state.pool[1], USDG.decimals, 2)}</strong></div>
        <div><span>Mid price</span><strong>${midPrice(state.pool, state.stock) ? `$${midPrice(state.pool, state.stock).toFixed(2)}` : "—"}</strong></div>
        <div class="reserve-depth"><span>Lane health</span><div class="depth-bar"><div class="depth-fill" style="width:${empty ? 0 : Math.max(laneHealth(state.pool), 8)}%"></div></div></div>
      </div>

      ${setupStripHtml(account)}
    </section>

    <div class="extras-grid">
      ${lanePulseHtml()}
      ${activityFeedHtml()}
    </div>

    <section class="facts">
      <article class="fact surface-card liquid-glass liquid-glass-hover"><h3>Route intel</h3><p>Live price impact, min received, and fee estimate before you sign — not just a blind swap.</p></article>
      <article class="fact surface-card liquid-glass liquid-glass-hover"><h3>Lane pulse</h3><p>Compare every ticker's mid price, USDG depth, and health score side by side.</p></article>
      <article class="fact surface-card liquid-glass liquid-glass-hover"><h3>On-chain feed</h3><p>Watch recent routes from the contract, plus your own trade history when connected.</p></article>
    </section>
  `);

  bindHomeEvents();
}

function bindHomeEvents() {
  $$("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.terminalTab = btn.dataset.tab;
      state.liqOpen = state.terminalTab === "deposit";
      syncHashParams();
      render();
    });
  });

  $$("[data-slip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.slippage = Number(btn.dataset.slip);
      render();
    });
  });

  $("#add-network")?.addEventListener("click", async () => {
    try {
      await ensureChain();
      setFlash("ok", `${CHAIN.name} added to wallet.`);
    } catch (err) {
      setFlash("err", err?.message || "Could not add network.");
    }
  });

  $("#disconnect-btn")?.addEventListener("click", async () => {
    await disconnect();
    state.balances = {};
    setFlash("ok", "Disconnected.");
    render();
  });

  const selectStock = async (symbol) => {
    state.stock = STOCKS.find((s) => s.symbol === symbol) || STOCKS[0];
    state.amountIn = "";
    state.amountOut = "";
    syncHashParams();
    await refreshPool();
    await refreshQuote();
    render();
  };

  $$("[data-stock]").forEach((btn) => {
    btn.addEventListener("click", () => selectStock(btn.dataset.stock));
  });

  $$("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.mode = btn.dataset.mode;
      state.amountIn = "";
      state.amountOut = "";
      syncHashParams();
      await refreshQuote();
      render();
    });
  });

  let quoteTimer;
  $("#amount-in")?.addEventListener("input", (e) => {
    state.amountIn = e.target.value.replace(/[^0-9.]/g, "");
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      await refreshQuote();
      render({ refocus: true });
    }, 350);
  });

  $("[data-max='in']")?.addEventListener("click", async () => {
    const tokenIn = state.mode === "buy" ? USDG : state.stock;
    const bal = state.balances[tokenIn.address.toLowerCase()] ?? 0n;
    state.amountIn = formatUnits(bal, tokenIn.decimals);
    await refreshQuote();
    render();
  });

  $("#swap-btn")?.addEventListener("click", executeSwap);
  $("#jump-liq")?.addEventListener("click", () => {
    state.terminalTab = "deposit";
    state.liqOpen = true;
    render();
  });

  $("#liq-stock")?.addEventListener("input", (e) => { state.liqStock = e.target.value.replace(/[^0-9.]/g, ""); });
  $("#liq-usdg")?.addEventListener("input", (e) => { state.liqUsdg = e.target.value.replace(/[^0-9.]/g, ""); });
  $("#liq-btn")?.addEventListener("click", executeLiquidity);
}

const DOCS_PAGES = {
  "/docs": { title: "Overview", lead: "Swap tokenized stocks on Robinhood Chain testnet.", render: docsOverview },
  "/docs/how-to-use": { title: "How to swap", lead: "Wallet setup and trade flow.", render: docsHowTo },
  "/docs/tokens": { title: "Token addresses", lead: "USDG and stock token contracts.", render: docsTokens },
  "/docs/architecture": { title: "How it works", lead: "AMM mechanics and contract surface.", render: docsArchitecture },
  "/docs/liquidity": { title: "Liquidity", lead: "Seeding empty pools.", render: docsLiquidity },
  "/docs/contract": { title: "Contract", lead: "Deployed addresses.", render: docsContract },
};

function docsTabs(path) {
  return Object.entries(DOCS_PAGES).map(([href, p]) =>
    `<a href="#${href}" class="doc-tab ${path === href ? "active" : ""}">${p.title}</a>`
  ).join("");
}

function renderDocs() {
  const path = route();
  const page = DOCS_PAGES[path] || DOCS_PAGES["/docs"];

  renderShell(`
    <section class="doc-page">
      <div class="doc-tabs">${docsTabs(path in DOCS_PAGES ? path : "/docs")}</div>
      <div class="doc-header">
        <h1>${page.title}</h1>
        <p>${page.lead}</p>
      </div>
      <article class="doc-body">${page.render()}</article>
    </section>
  `);
}

function docsOverview() {
  return `
    <p>${BRAND.name} is a minimal AMM on ${CHAIN.name}. Swap tokenized equities against USDG — each ticker has its own pool. Connect any EVM wallet, no registration.</p>
    <h2>Requirements</h2>
    <ul>
      <li><strong>ETH</strong> for gas</li>
      <li><strong>USDG</strong> to buy stocks</li>
      <li><strong>Stock tokens</strong> to sell</li>
    </ul>
    <p>USDG: <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">Paxos testnet faucet</a>. Addresses: <a href="#/docs/tokens">token list</a>.</p>
    <a href="#/" class="btn-primary inline">Open markets</a>
  `;
}

function docsHowTo() {
  return `
    <h2>1. Add the network</h2>
    <p>Chain ID <code>${CHAIN.id}</code> · RPC <code>${CHAIN.rpc}</code></p>
    <button class="btn-secondary inline" id="docs-add-network">Add network</button>
    <h2>2. Connect wallet</h2>
    <p>Click <strong>Connect</strong> in the header. Approve the connection and ensure you're on ${CHAIN.name}.</p>
    <h2>3. Swap</h2>
    <ol>
      <li>Pick a lane in the terminal rail.</li>
      <li>Choose USDG → ticker or ticker → USDG.</li>
      <li>Enter an amount and confirm in your wallet.</li>
    </ol>
  `;
}

function docsTokens() {
  return `
    <table class="data-table">
      <thead><tr><th>Symbol</th><th>Name</th><th>Address</th></tr></thead>
      <tbody>
        <tr><td>USDG</td><td>USDG Stablecoin</td><td><code>${USDG.address}</code></td></tr>
        ${STOCKS.map((s) => `<tr><td>${s.symbol}</td><td>${s.name}</td><td><code>${s.address}</code></td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function docsArchitecture() {
  return `
    <p>Constant-product pools pair each stock token with USDG.</p>
    <ul>
      <li><code>getPool(stock)</code> — read reserves</li>
      <li><code>getAmountOut(stock, tokenIn, amountIn)</code> — quote</li>
      <li><code>swap(...)</code> — execute trade</li>
      <li><code>addLiquidity(...)</code> — seed or deepen a pool</li>
    </ul>
  `;
}

function docsLiquidity() {
  return `
    <p>Swaps require both sides of the lane to hold tokens. Use the <strong>Deposit</strong> tab in the terminal.</p>
    <p>Example seed: 0.1 stock + 10 USDG per market.</p>
  `;
}

function docsContract() {
  return `
    <table class="data-table">
      <tbody>
        <tr><th>Swap contract</th><td><code>${CONTRACT.address}</code></td></tr>
        <tr><th>Deployer</th><td><code>${CONTRACT.deployer}</code></td></tr>
        <tr><th>Chain</th><td>${CHAIN.name} (${CHAIN.id})</td></tr>
      </tbody>
    </table>
    <p><a href="${CHAIN.explorer}/address/${CONTRACT.address}" target="_blank" rel="noreferrer">View on explorer</a></p>
    <p class="fine">Testnet demo. Not affiliated with Robinhood Markets.</p>
  `;
}

function explorerLink(label, href, sub = "") {
  return `
    <a class="explorer-row" href="${href}" target="_blank" rel="noreferrer">
      <span class="explorer-row-label">${label}</span>
      ${sub ? `<span class="explorer-row-sub">${sub}</span>` : ""}
      <span class="explorer-row-arrow" aria-hidden="true"></span>
    </a>
  `;
}

function poolCardHtml(s) {
  const pool = state.allPools[s.symbol] || [0n, 0n];
  const empty = poolEmpty(pool);
  const active = s.symbol === state.stock.symbol;
  return `
    <article class="pool-card liquid-glass liquid-glass-hover" style="${active ? "border-color:rgba(139,92,246,0.4)" : ""}">
      <div class="pool-card-head">
        <div class="pool-card-ticker">
          <span class="market-pill-dot" style="background:${s.hue}"></span>
          <div><h3>${s.symbol}</h3><span>${s.name}</span></div>
        </div>
        <span class="pool-status ${empty ? "empty" : "live"}">${empty ? "Empty" : "Live"}</span>
      </div>
      <div class="pool-metrics">
        <div class="pool-metric"><span>Mid price</span><strong>${empty ? "—" : midPrice(pool, s) ? `$${midPrice(pool, s).toFixed(2)}` : "—"}</strong></div>
        <div class="pool-metric"><span>USDG depth</span><strong>${fmt(pool[1], USDG.decimals, 2)}</strong></div>
      </div>
      <div class="depth-bar"><div class="depth-fill" style="width:${empty ? 0 : Math.max(laneHealth(pool), 6)}%"></div></div>
      <a href="#/" class="btn-secondary" data-goto="${s.symbol}">${empty ? "Seed pool" : "Trade"} ${s.symbol}</a>
    </article>
  `;
}

function renderPools() {
  renderShell(`
    <section class="sub-page">
      <div class="sub-header">
        <h1>Reserve lanes</h1>
        <p>${countLivePools()} of ${STOCKS.length} lanes seeded on ${CHAIN.name}. Each ticker vault pairs independently with USDG.</p>
      </div>
      <div class="pools-grid">
        ${STOCKS.map(poolCardHtml).join("")}
      </div>
    </section>
  `);

  $$("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      state.stock = STOCKS.find((s) => s.symbol === btn.dataset.goto) || STOCKS[0];
      state.amountIn = "";
      state.amountOut = "";
      location.hash = "#/";
      await refreshPool();
      await refreshQuote();
      render();
    });
  });
}

function renderFaucet() {
  renderShell(`
    <section class="sub-page">
      <div class="sub-header">
        <h1>Testnet Faucet</h1>
        <p>Grab gas and USDG before your first swap on ${BRAND.name}.</p>
      </div>
      <div class="faucet-grid">
        <article class="faucet-card liquid-glass liquid-glass-hover">
          <span class="faucet-tag">ETH</span>
          <h3>ETH for gas</h3>
          <p>Robinhood Chain testnet ETH covers swap and liquidity transactions.</p>
          <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer" class="btn-primary inline">Open ETH faucet</a>
        </article>
        <article class="faucet-card liquid-glass liquid-glass-hover">
          <span class="faucet-tag">USDG</span>
          <h3>USDG stablecoin</h3>
          <p>USDG is the quote asset for every stock pool. Mint test USDG via Paxos.</p>
          <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer" class="btn-primary inline">Open USDG faucet</a>
        </article>
      </div>
      <article class="sub-body surface-card liquid-glass">
        <h2>Setup checklist</h2>
        <ol class="steps-list">
          <li>Install MetaMask or any EVM wallet extension.</li>
          <li>Add ${CHAIN.name} (chain ID <code>${CHAIN.id}</code>) from the Trade page.</li>
          <li>Claim ETH from the Robinhood faucet for transaction fees.</li>
          <li>Mint USDG from the Paxos testnet faucet.</li>
          <li>Connect your wallet and swap — or seed an empty pool with liquidity.</li>
        </ol>
        <p class="fine">Stock tokens are already deployed on testnet. You only need ETH + USDG to start buying.</p>
        <a href="#/" class="btn-secondary inline">Back to trade</a>
      </article>
    </section>
  `);
}

function renderExplorer() {
  renderShell(`
    <section class="sub-page">
      <div class="sub-header">
        <h1>Explorer</h1>
        <p>On-chain addresses and block explorer links for ${CHAIN.name}.</p>
      </div>
      <div class="sub-body">
        <h2>Network</h2>
        <div class="link-list">
          ${explorerLink("Block explorer", CHAIN.explorer, "explorer.testnet.chain.robinhood.com")}
          ${explorerLink("Deploy transaction", `${CHAIN.explorer}/tx/${CONTRACT.deployTx}`, shortAddr(CONTRACT.deployTx))}
        </div>
        <h2>Contracts</h2>
        <div class="link-list">
          ${explorerLink("Swap contract", `${CHAIN.explorer}/address/${CONTRACT.address}`, CONTRACT.address)}
          ${explorerLink("Deployer wallet", `${CHAIN.explorer}/address/${CONTRACT.deployer}`, CONTRACT.deployer)}
        </div>
        <h2>Tokens</h2>
        <div class="link-list">
          ${explorerLink("USDG", `${CHAIN.explorer}/address/${USDG.address}`, USDG.address)}
          ${STOCKS.map((s) => explorerLink(`${s.symbol} · ${s.name}`, `${CHAIN.explorer}/address/${s.address}`, s.address)).join("")}
        </div>
      </div>
    </section>
  `);
}

function roadmapItem(status, phase, title, body) {
  return `
    <li class="roadmap-item ${status}">
      <div class="roadmap-marker"></div>
      <div class="roadmap-content">
        <span class="roadmap-phase">${phase}</span>
        <h3>${title}</h3>
        <p>${body}</p>
      </div>
    </li>
  `;
}

function renderRoadmap() {
  renderShell(`
    <section class="sub-page">
      <div class="sub-header">
        <h1>Roadmap</h1>
        <p>Where ${BRAND.name} is today and what's coming next on Robinhood Chain testnet.</p>
      </div>
      <ol class="roadmap">
        ${roadmapItem("done", "Phase 01 · Live", "Exchange terminal", "Wallet connect, lane selector, live reserve reads, and routed swaps against the deployed AMM.")}
        ${roadmapItem("done", "Phase 02 · Live", "Reserve dashboard", "Per-lane vault view with depth bars and one-click jump back to the terminal.")}
        ${roadmapItem("active", "Phase 03 · Now", "Lane seeding", "Deposit into remaining empty lanes and grow testnet reserves across all five pairs.")}
        ${roadmapItem("done", "Phase 04 · Live", "Route analytics", "Price impact, lane pulse board, portfolio book, slippage controls, and live on-chain route feed.")}
        ${roadmapItem("planned", "Phase 05", "More tickers", "Expand as new tokenized equities deploy on Robinhood Chain.")}
        ${roadmapItem("planned", "Phase 06", "Mainnet", "Audits, production config, and deployment when RH Chain mainnet opens.")}
      </ol>
    </section>
  `);
}

function render(opts = {}) {
  const path = route();
  const active = document.activeElement?.id;
  if (path.startsWith("/docs")) {
    renderDocs();
    $("#docs-add-network")?.addEventListener("click", async () => {
      try { await ensureChain(); alert(`${CHAIN.name} added.`); }
      catch (e) { alert(e.message); }
    });
  } else if (path === "/pools") {
    renderPools();
  } else if (path === "/faucet") {
    renderFaucet();
  } else if (path === "/explorer") {
    renderExplorer();
  } else if (path === "/roadmap") {
    renderRoadmap();
  } else {
    renderHome();
    if (opts.refocus && active) {
      const el = document.getElementById(active);
      if (el) {
        el.focus();
        if (el.setSelectionRange && typeof el.value === "string") {
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }
    }
  }
}

let pollTick = 0;

function startPoolPolling() {
  clearInterval(poolPollTimer);
  poolPollTimer = setInterval(async () => {
    if (route() !== "/" && route() !== "/liquidity") return;
    await refreshAllPools();
    pollTick += 1;
    if (pollTick % 3 === 0) await refreshActivity();
    if (state.amountIn) await refreshQuote();
    render({ refocus: Boolean(document.activeElement?.id === "amount-in") });
  }, 20000);
}

async function init() {
  bindWalletEvents(async () => {
    await refreshBalances();
    await refreshAllPools();
    await refreshActivity();
    render();
  });

  applyHashParams();
  await restoreSession();
  await refreshAllPools();
  await refreshActivity();

  if (hasAccount()) await refreshBalances();

  render();
  syncHashParams();
  startPoolPolling();
}

window.addEventListener("hashchange", async () => {
  applyHashParams();
  render();
  if (!route().startsWith("/docs")) {
    await refreshAllPools();
    if (route() === "/" || route() === "/liquidity") await refreshActivity();
  }
});

init();