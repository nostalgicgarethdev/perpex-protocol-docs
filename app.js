import { Contract, formatUnits, parseUnits } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import {
  BRAND,
  CHAIN,
  CONTRACT,
  USDG,
  STOCKS,
  LINKS,
  SLIPPAGE_BPS,
  SWAP_ABI,
  ERC20_ABI,
} from "./config.js";
import {
  getReadProvider,
  getSigner,
  getAccount,
  isConnected,
  hasWallet,
  ensureChain,
  connect,
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
  liqStock: "",
  liqUsdg: "",
  flash: null,
  walletBusy: false,
};

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
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path === "/liquidity") state.liqOpen = true;
  return path;
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

function swapContract() {
  const signer = getSigner();
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
  state.walletBusy = true;
  render();
  try {
    const result = await handleWalletClick();
    if (result === "connected") {
      await refreshBalances();
      await refreshAllPools();
      await refreshQuote();
      setFlash("ok", "Wallet connected.");
    } else {
      state.balances = {};
      setFlash("ok", "Wallet disconnected.");
    }
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
    const signer = getSigner();
    const quoted = await swapContract().getAmountOut(state.stock.address, tokenIn.address, rawIn);
    const minOut = (quoted * BigInt(10000 - state.slippage)) / 10000n;
    await approveIfNeeded(tokenIn, rawIn);
    setFlash("ok", "Confirm swap in your wallet…");
    const tx = await swapContract().connect(signer).swap(
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
  state.busy = true;
  render();
  try {
    const signer = getSigner();
    await approveIfNeeded(state.stock, stockAmt);
    await approveIfNeeded(USDG, usdgAmt);
    setFlash("ok", "Confirm liquidity deposit in your wallet…");
    const tx = await swapContract().connect(signer).addLiquidity(
      state.stock.address,
      stockAmt,
      usdgAmt
    );
    await tx.wait();
    state.liqStock = "";
    state.liqUsdg = "";
    await refreshBalances();
    await refreshAllPools();
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
  return state.mode === "buy" ? `Buy ${state.stock.symbol}` : `Sell ${state.stock.symbol}`;
}

function poolEmpty(pool = state.pool) {
  return pool[0] === 0n && pool[1] === 0n;
}

function renderShell(content) {
  const path = route();
  const isDocs = path.startsWith("/docs");
  const account = getAccount();

  $("#app").innerHTML = `
    <div class="app">
      <header class="topbar">
        <a href="#/" class="brand">
          <img src="/assets/logo-mark.svg" alt="" width="30" height="30" />
          <span>${BRAND.name}</span>
        </a>
        <nav class="topnav">
          <a href="#/" class="topnav-link ${path === "/" ? "active" : ""}">Markets</a>
          <a href="#/docs" class="topnav-link ${isDocs ? "active" : ""}">Docs</a>
        </nav>
        <div class="topbar-end">
          <span class="chain-pill">${CHAIN.name}</span>
          <button class="wallet-btn ${account ? "on" : ""}" id="connect-btn" ${state.walletBusy ? "disabled" : ""}>
            ${state.walletBusy ? "…" : account ? shortAddr(account) : "Connect"}
          </button>
        </div>
      </header>
      <main class="page">${content}</main>
      <footer class="page-foot">
        <span>${BRAND.name} · Chain ${CHAIN.id}</span>
        <span class="page-foot-links">
          <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer">ETH faucet</a>
          <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">USDG faucet</a>
          <a href="${CHAIN.explorer}" target="_blank" rel="noreferrer">Explorer</a>
        </span>
      </footer>
    </div>
  `;

  $("#connect-btn")?.addEventListener("click", onConnectClick);
}

function marketListHtml() {
  return STOCKS.map((s) => {
    const pool = state.allPools[s.symbol] || [0n, 0n];
    const active = s.symbol === state.stock.symbol;
    const empty = poolEmpty(pool);
    return `
      <button class="market-row ${active ? "active" : ""}" data-stock="${s.symbol}">
        <div class="market-row-top">
          <span class="market-sym">${s.symbol}</span>
          <span class="market-name">${s.name}</span>
        </div>
        <div class="market-row-meta">
          <span>${empty ? "No liquidity" : `${fmt(pool[0], s.decimals, 1)} / ${fmt(pool[1], USDG.decimals, 0)} USDG`}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderHome() {
  const account = getAccount();
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  const tokenOut = state.mode === "buy" ? state.stock : USDG;
  const balIn = state.balances[tokenIn.address.toLowerCase()];
  const empty = poolEmpty();

  renderShell(`
    <section class="intro">
      <p class="intro-tag">Spot · Testnet</p>
      <h1>${BRAND.tagline}</h1>
      <p class="intro-sub">Trade tokenized equities against USDG on Robinhood Chain. Connect a wallet, pick a market, swap.</p>
    </section>

    <div class="trade-layout">
      <aside class="markets-panel">
        <div class="panel-head">
          <h2>Markets</h2>
          <span class="panel-sub">${STOCKS.length} pairs</span>
        </div>
        <div class="market-list">${marketListHtml()}</div>
        ${!account ? `
        <div class="setup-card">
          <h3>Setup</h3>
          <p>Add Robinhood Chain testnet to your wallet before connecting.</p>
          <button class="btn-secondary" id="add-network">Add network</button>
          ${!hasWallet() ? `<p class="setup-warn">No wallet extension detected.</p>` : ""}
        </div>` : `
        <div class="setup-card connected-card">
          <h3>Wallet</h3>
          <p class="mono">${shortAddr(account)}</p>
          <button class="btn-text" id="disconnect-btn">Disconnect</button>
        </div>`}
      </aside>

      <section class="trade-panel">
        <div class="trade-card">
          <div class="trade-card-head">
            <div>
              <h2>${state.stock.symbol} / USDG</h2>
              <p>${state.stock.name} · 0.3% fee</p>
            </div>
            <div class="dir-switch">
              <button class="dir-btn ${state.mode === "buy" ? "active" : ""}" data-mode="buy">Buy</button>
              <button class="dir-btn ${state.mode === "sell" ? "active" : ""}" data-mode="sell">Sell</button>
            </div>
          </div>

          <div class="field">
            <div class="field-top">
              <label>Pay with</label>
              ${balIn !== undefined && account ? `<button class="field-max" data-max="in">Max ${fmt(balIn, tokenIn.decimals, 2)}</button>` : ""}
            </div>
            <div class="field-row">
              <input id="amount-in" type="text" inputmode="decimal" placeholder="0.00" value="${state.amountIn}" />
              <span class="field-token">${tokenIn.symbol}</span>
            </div>
          </div>

          <div class="field">
            <div class="field-top"><label>Receive</label></div>
            <div class="field-row">
              <input class="readonly" readonly placeholder="0.00" value="${state.amountOut ? Number(state.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 }) : ""}" />
              <span class="field-token">${tokenOut.symbol}</span>
            </div>
          </div>

          <div class="trade-stats">
            <div><span>Pool ${state.stock.symbol}</span><strong>${fmt(state.pool[0], state.stock.decimals, 2)}</strong></div>
            <div><span>Pool USDG</span><strong>${fmt(state.pool[1], USDG.decimals, 2)}</strong></div>
            <div><span>Slippage</span><strong>${(state.slippage / 100).toFixed(1)}%</strong></div>
          </div>

          ${empty ? `
          <div class="notice">
            <strong>Pool empty.</strong> Add ${state.stock.symbol} + USDG liquidity before swapping.
            <button class="btn-text" id="jump-liq">Add liquidity →</button>
          </div>` : ""}

          <button class="btn-primary" id="swap-btn" ${state.busy || state.walletBusy || empty ? "disabled" : ""}>
            ${swapButtonLabel()}
          </button>

          ${state.flash ? `<div class="toast ${state.flash.type}">${state.flash.msg}</div>` : ""}
        </div>

        <details class="liq-details" id="liquidity" ${state.liqOpen ? "open" : ""}>
          <summary>Provide liquidity</summary>
          <div class="liq-body">
            <p>${empty
              ? `Seed this pool with both tokens. Try 0.1 ${state.stock.symbol} + 10 USDG.`
              : "Add more stock and USDG to deepen the pool."}</p>
            ${empty ? `<p class="liq-faucets"><a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer">ETH faucet</a> · <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">USDG faucet</a></p>` : ""}
            <div class="liq-fields">
              <label>${state.stock.symbol}<input id="liq-stock" type="text" inputmode="decimal" placeholder="0.1" value="${state.liqStock}" /></label>
              <label>USDG<input id="liq-usdg" type="text" inputmode="decimal" placeholder="10" value="${state.liqUsdg}" /></label>
            </div>
            <button class="btn-secondary" id="liq-btn" ${state.busy || state.walletBusy ? "disabled" : ""}>
              ${!isConnected() ? "Connect wallet" : state.busy ? "Processing…" : "Add liquidity"}
            </button>
          </div>
        </details>
      </section>
    </div>

    <section class="facts">
      <article class="fact"><h3>Constant-product AMM</h3><p>x·y = k with 0.3% swap fee retained in the pool.</p></article>
      <article class="fact"><h3>Isolated pools</h3><p>Each stock has its own USDG pair — reserves are independent.</p></article>
      <article class="fact"><h3>Self-custody</h3><p>No accounts. Your wallet signs every swap and liquidity deposit.</p></article>
    </section>
  `);

  bindHomeEvents();
}

function bindHomeEvents() {
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

  $$("[data-stock]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stock = STOCKS.find((s) => s.symbol === btn.dataset.stock) || STOCKS[0];
      state.amountIn = "";
      state.amountOut = "";
      await refreshPool();
      await refreshQuote();
      render();
    });
  });

  $$("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.mode = btn.dataset.mode;
      state.amountIn = "";
      state.amountOut = "";
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
    state.liqOpen = true;
    document.getElementById("liquidity")?.setAttribute("open", "");
    document.getElementById("liquidity")?.scrollIntoView({ behavior: "smooth" });
  });

  const liqDetails = $("#liquidity");
  liqDetails?.addEventListener("toggle", () => { state.liqOpen = liqDetails.open; });
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
    <p>Perpex Spot exchanges tokenized equities against USDG on Robinhood Chain testnet. Connect any EVM wallet — no registration.</p>
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
      <li>Select a market from the left panel.</li>
      <li>Toggle Buy or Sell.</li>
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
    <p>Swaps require both sides of the pool to hold tokens. Use the <strong>Provide liquidity</strong> section on the Markets page.</p>
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
    <p><a href="${CHAIN.explorer}/address/${CONTRACT.address}" target="_blank" rel="noreferrer">View on explorer →</a></p>
    <p class="fine">Testnet demo. Not affiliated with Robinhood Markets.</p>
  `;
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

async function init() {
  bindWalletEvents(async () => {
    await refreshBalances();
    await refreshAllPools();
    render();
  });

  await restoreSession();
  await refreshAllPools();

  if (isConnected()) await refreshBalances();

  render();
}

window.addEventListener("hashchange", async () => {
  render();
  if (!route().startsWith("/docs")) await refreshAllPools();
});

init();