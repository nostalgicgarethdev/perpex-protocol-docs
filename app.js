import { BrowserProvider, Contract, formatUnits, parseUnits } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
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

const ACCENT = "#0E9E92";
const ACCENT_BRIGHT = "#14C2B2";

const $ = (sel, root = document) => root.querySelector(sel);

let provider = null;
let signer = null;
let account = null;

const state = {
  stock: STOCKS[0],
  mode: "buy",
  amountIn: "",
  amountOut: "",
  pool: [0n, 0n],
  balances: {},
  slippage: SLIPPAGE_BPS,
  busy: false,
  liqOpen: false,
  liqStock: "",
  liqUsdg: "",
  flash: null,
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
  if (path === "/provide-liquidity") state.liqOpen = true;
  return path;
}

function setFlash(type, msg) {
  state.flash = msg ? { type, msg } : null;
  render();
  if (msg) setTimeout(() => { if (state.flash?.msg === msg) { state.flash = null; render(); } }, 6000);
}

async function ensureChain() {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or another EVM wallet.");
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
}

async function switchChain() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.hexId }],
    });
  } catch (err) {
    if (err?.code === 4902) await ensureChain();
    else throw err;
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      setFlash("err", "Install MetaMask or another EVM wallet to connect.");
      return;
    }
    await switchChain();
    provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    account = accounts[0]?.toLowerCase();
    await refreshBalances();
    await refreshPool();
    await refreshQuote();
    render();
  } catch (err) {
    setFlash("err", err?.message || "Failed to connect wallet.");
  }
}

function swapContract() {
  return new Contract(CONTRACT.address, SWAP_ABI, signer || provider);
}

function erc20(token, withSigner = false) {
  return new Contract(token.address, ERC20_ABI, withSigner && signer ? signer : provider);
}

async function refreshPool() {
  if (!provider) return;
  try {
    const pool = await swapContract().getPool(state.stock.address);
    state.pool = [pool.reserveStock ?? pool[0], pool.reserveUsdg ?? pool[1]];
  } catch {
    state.pool = [0n, 0n];
  }
}

async function refreshBalances() {
  if (!account || !provider) return;
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
  if (!provider || !state.amountIn || Number(state.amountIn) <= 0) {
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
  const c = erc20(token, true);
  const allowance = await c.allowance(account, CONTRACT.address);
  if (allowance >= amount) return;
  setFlash("ok", `Approve ${token.symbol} in your wallet…`);
  const tx = await c.approve(CONTRACT.address, amount);
  await tx.wait();
}

async function executeSwap() {
  if (!signer || !account) return connectWallet();
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
    setFlash("err", "Pool is empty. Add liquidity first.");
    return;
  }

  state.busy = true;
  render();
  try {
    const quoted = await swapContract().getAmountOut(state.stock.address, tokenIn.address, rawIn);
    const minOut = quoted * BigInt(10000 - state.slippage) / 10000n;
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
    setFlash("err", err?.shortMessage || err?.message || "Swap failed.");
  } finally {
    state.busy = false;
    render();
  }
}

async function executeLiquidity() {
  if (!signer || !account) return connectWallet();
  if (!state.liqStock || !state.liqUsdg) return;
  const stockAmt = parseUnits(state.liqStock, state.stock.decimals);
  const usdgAmt = parseUnits(state.liqUsdg, USDG.decimals);
  state.busy = true;
  render();
  try {
    await approveIfNeeded(state.stock, stockAmt);
    await approveIfNeeded(USDG, usdgAmt);
    setFlash("ok", "Confirm add liquidity in your wallet…");
    const tx = await swapContract().connect(signer).addLiquidity(state.stock.address, stockAmt, usdgAmt);
    await tx.wait();
    state.liqStock = "";
    state.liqUsdg = "";
    await refreshBalances();
    await refreshPool();
    setFlash("ok", "Liquidity added.");
  } catch (err) {
    setFlash("err", err?.shortMessage || err?.message || "Add liquidity failed.");
  } finally {
    state.busy = false;
    render();
  }
}

function swapButtonLabel() {
  if (!account) return "Connect wallet";
  if (!state.amountIn || Number(state.amountIn) <= 0) return "Enter amount";
  if (state.busy) return "Processing…";
  if (state.pool[0] === 0n && state.pool[1] === 0n) return "Pool empty";
  return state.mode === "buy" ? `Buy ${state.stock.symbol}` : `Sell ${state.stock.symbol}`;
}

function liqButtonLabel() {
  if (!account) return "Connect wallet";
  if (!state.liqStock || !state.liqUsdg) return "Enter amounts";
  if (state.busy) return "Processing…";
  return "Add liquidity";
}

function poolEmpty() {
  return state.pool[0] === 0n && state.pool[1] === 0n;
}

function renderShell(content) {
  const path = route();
  const isDocs = path.startsWith("/docs");

  $("#app").innerHTML = `
    <div class="shell">
      <div class="float-header">
        <header class="nav-bar">
          <div class="nav-brand">
            <a href="#/" class="logo">
              <img class="logo-mark" src="/assets/logo-mark.svg" alt="" width="28" height="28" />
              <span class="logo-word">${BRAND.name}</span>
            </a>
          </div>
          <nav class="nav-links">
            <a href="#/" class="nav-link ${path === "/" ? "active" : ""}">Swap</a>
            <a href="#/docs" class="nav-link ${isDocs ? "active" : ""}">Docs</a>
            <a href="${CHAIN.explorer}" target="_blank" rel="noreferrer" class="nav-link">Explorer</a>
            <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer" class="nav-link">Faucet</a>
          </nav>
          <div class="nav-actions">
            <a href="${LINKS.launchpad}" target="_blank" rel="noreferrer" class="nav-link hide-mobile">Perps</a>
            <a href="${LINKS.x}" target="_blank" rel="noreferrer" class="nav-x">@tradeperpex</a>
            <button class="btn-connect ${account ? "connected" : ""}" id="connect-btn">
              ${account ? shortAddr(account) : "Connect wallet"}
            </button>
          </div>
        </header>
      </div>

      <main class="shell-body">${content}</main>

      <div class="float-footer">
        <footer class="footer-bar">
          <div>
            <div class="footer-brand">${BRAND.name}</div>
            <div class="footer-tag">${BRAND.name} swap on Robinhood Chain testnet — from the team behind tradeperpex.fun.</div>
          </div>
          <nav class="footer-nav">
            <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer">ETH faucet</a>
            <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">USDG faucet</a>
            <a href="${CHAIN.explorer}" target="_blank" rel="noreferrer">Explorer</a>
            <a href="#/docs">Docs</a>
          </nav>
        </footer>
      </div>
    </div>
  `;

  $("#connect-btn")?.addEventListener("click", connectWallet);
}

function renderHome() {
  const tokenIn = state.mode === "buy" ? USDG : state.stock;
  const tokenOut = state.mode === "buy" ? state.stock : USDG;
  const balIn = state.balances[tokenIn.address.toLowerCase()];

  renderShell(`
    ${!account ? `
    <div class="network-banner">
      <div class="network-banner-inner">
        <span>Add Robinhood Chain testnet to MetaMask or any EVM wallet.</span>
        <button class="network-banner-btn" id="add-network">Add network</button>
      </div>
    </div>` : ""}

    <div class="home">
      <section class="home-hero">
        <div class="home-headline">
          <p class="home-headline-kicker">Perpex · Robinhood Chain</p>
          <h1>Swap tokenized stocks. No gatekeepers.</h1>
        </div>
      </section>

      <div class="home-stage">
        <aside class="home-aside">
          <p class="home-kicker">How it works</p>
          <ul class="aside-steps">
            <li class="aside-step"><div><strong>Pick a stock</strong>TSLA, AMZN, PLTR, NFLX, or AMD — each pairs with USDG.</div></li>
            <li class="aside-step"><div><strong>Buy or sell</strong>Buy with USDG, sell for USDG. Constant-product AMM with 0.3% fee.</div></li>
            <li class="aside-step"><div><strong>Connect wallet</strong>Robinhood Chain testnet (chain ID 46630). No sign-up.</div></li>
          </ul>
          <a href="#/docs" class="aside-cta">Read the docs →</a>
        </aside>

        <div class="home-swap" id="swap">
          <div class="swap-stack">
            <div class="picker">
              ${STOCKS.map((s) => `
                <button class="picker-item ${s.symbol === state.stock.symbol ? "active" : ""}" data-stock="${s.symbol}">
                  ${s.symbol}
                </button>
              `).join("")}
            </div>

            <div class="swap-head">
              <p class="swap-pair">${state.stock.symbol} / USDG</p>
              <span class="swap-mode">${state.mode === "buy" ? "Buy" : "Sell"}</span>
            </div>

            <div class="mode-toggle">
              <button class="mode-btn ${state.mode === "buy" ? "active" : ""}" data-mode="buy">Buy</button>
              <button class="mode-btn ${state.mode === "sell" ? "active" : ""}" data-mode="sell">Sell</button>
            </div>

            <div class="swap-body">
              <div class="amount">
                <div class="amount-top">
                  <span class="amount-label">You pay</span>
                  ${balIn !== undefined && account ? `<button class="amount-max" data-max="in">Max ${fmt(balIn, tokenIn.decimals, 2)}</button>` : ""}
                </div>
                <div class="amount-row">
                  <input class="amount-input" id="amount-in" type="text" inputmode="decimal" placeholder="0" value="${state.amountIn}" />
                  <span class="amount-token">${tokenIn.symbol}</span>
                </div>
              </div>

              <div class="swap-mid">
                <button class="flip-btn" id="flip-mode" title="Flip direction">⇅</button>
              </div>

              <div class="amount">
                <div class="amount-top">
                  <span class="amount-label">You receive</span>
                </div>
                <div class="amount-row">
                  <input class="amount-input readonly" readonly placeholder="0" value="${state.amountOut ? Number(state.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 }) : ""}" />
                  <span class="amount-token">${tokenOut.symbol}</span>
                </div>
              </div>

              <div class="swap-meta">
                <div class="meta-row"><span>Pool ${state.stock.symbol}</span><span>${fmt(state.pool[0], state.stock.decimals, 2)}</span></div>
                <div class="meta-row"><span>Pool USDG</span><span>${fmt(state.pool[1], USDG.decimals, 2)}</span></div>
                <div class="slippage-row"><span>Slippage tolerance</span><span>${(state.slippage / 100).toFixed(1)}%</span></div>
              </div>

              ${poolEmpty() ? `
              <div class="swap-empty-pool">
                <p><strong>Pool empty.</strong> Nobody can swap until someone adds ${state.stock.symbol} + USDG.</p>
                <a class="swap-empty-link" href="#provide-liquidity" id="jump-liq">Provide liquidity →</a>
              </div>` : ""}

              <button class="cta" id="swap-btn" ${state.busy || poolEmpty() ? "disabled" : ""}>${swapButtonLabel()}</button>
              ${state.flash ? `<div class="flash ${state.flash.type}">${state.flash.msg}</div>` : ""}
            </div>

            <section class="liq" id="provide-liquidity">
              <button class="liq-trigger" id="liq-toggle">${state.liqOpen ? "▾" : "▸"} Provide liquidity</button>
              ${state.liqOpen ? `
              <div class="liq-panel">
                <p class="liq-note ${poolEmpty() ? "liq-note-strong" : ""}">
                  ${poolEmpty()
                    ? `This pool is empty. Add both tokens once from your wallet. Example: 0.1 ${state.stock.symbol} + 10 USDG.`
                    : "Pool already has liquidity. You can add more stock + USDG if you want."}
                </p>
                ${poolEmpty() ? `<p class="liq-note">Need tokens? <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer">ETH faucet</a> · <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">USDG faucet</a></p>` : ""}
                <div class="liq-inputs">
                  <div class="liq-input-row">
                    <label>${state.stock.symbol} amount</label>
                    <input id="liq-stock" type="text" inputmode="decimal" placeholder="0.1" value="${state.liqStock}" />
                  </div>
                  <div class="liq-input-row">
                    <label>USDG amount</label>
                    <input id="liq-usdg" type="text" inputmode="decimal" placeholder="10" value="${state.liqUsdg}" />
                  </div>
                </div>
                <button class="cta cta-outline" id="liq-btn" ${state.busy ? "disabled" : ""}>${liqButtonLabel()}</button>
              </div>` : ""}
            </section>
          </div>
        </div>
      </div>
    </div>

    <section class="explain">
      <div class="explain-head">
        <h2 class="explain-title">Stonks, onchain</h2>
        <p class="explain-lead">Real equities as ERC-20 tokens on Robinhood Chain testnet. Swap against USDG through Perpex in seconds.</p>
      </div>
      <div class="explain-grid">
        <article class="explain-card">
          <div class="explain-card-illu">
            <svg width="120" height="56" viewBox="0 0 120 56" fill="none"><rect x="8" y="8" width="40" height="40" rx="10" fill="#0c1626" fill-opacity="0.08"/><text x="28" y="34" text-anchor="middle" fill="#0c1626" font-size="12" font-weight="600">TSLA</text><rect x="72" y="8" width="40" height="40" rx="10" fill="${ACCENT}" fill-opacity="0.12" stroke="${ACCENT}"/><text x="92" y="34" text-anchor="middle" fill="${ACCENT}" font-size="12" font-weight="600">USDG</text></svg>
          </div>
          <h3>Stock tokens</h3>
          <p>Real equities like TSLA and AMZN exist as ERC-20 tokens on Robinhood Chain testnet.</p>
        </article>
        <article class="explain-card">
          <div class="explain-card-illu">
            <svg width="80" height="56" viewBox="0 0 80 56" fill="none"><path d="M8 40 L24 28 L40 32 L56 16 L72 20" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <h3>How the swap works</h3>
          <p>Each stock pairs with USDG. Pay one side, the pool calculates the rate, receive the other instantly.</p>
        </article>
        <article class="explain-card">
          <div class="explain-card-illu">
            <svg width="80" height="56" viewBox="0 0 80 56" fill="none"><rect x="16" y="12" width="48" height="32" rx="8" stroke="#0c1626" stroke-opacity="0.2"/><path d="M28 28h24" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round"/></svg>
          </div>
          <h3>No sign-up</h3>
          <p>Connect any EVM wallet on Robinhood Chain testnet. Self-custodied from the first swap.</p>
        </article>
      </div>
    </section>
  `);

  bindHomeEvents();
}

function bindHomeEvents() {
  $("#add-network")?.addEventListener("click", async () => {
    try { await ensureChain(); setFlash("ok", "Robinhood Chain testnet added."); }
    catch (err) { setFlash("err", err?.message || "Could not add network."); }
  });

  document.querySelectorAll("[data-stock]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stock = STOCKS.find((s) => s.symbol === btn.dataset.stock) || STOCKS[0];
      state.amountIn = "";
      state.amountOut = "";
      await refreshPool();
      render();
    });
  });

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.mode = btn.dataset.mode;
      state.amountIn = "";
      state.amountOut = "";
      await refreshQuote();
      render();
    });
  });

  $("#flip-mode")?.addEventListener("click", async () => {
    state.mode = state.mode === "buy" ? "sell" : "buy";
    state.amountIn = "";
    state.amountOut = "";
    await refreshQuote();
    render();
  });

  let quoteTimer;
  $("#amount-in")?.addEventListener("input", (e) => {
    state.amountIn = e.target.value.replace(/[^0-9.]/g, "");
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => { await refreshQuote(); render(); }, 300);
  });

  $("[data-max='in']")?.addEventListener("click", async () => {
    const tokenIn = state.mode === "buy" ? USDG : state.stock;
    const bal = state.balances[tokenIn.address.toLowerCase()] ?? 0n;
    state.amountIn = formatUnits(bal, tokenIn.decimals);
    await refreshQuote();
    render();
  });

  $("#swap-btn")?.addEventListener("click", executeSwap);
  $("#jump-liq")?.addEventListener("click", (e) => { e.preventDefault(); state.liqOpen = true; render(); });

  $("#liq-toggle")?.addEventListener("click", () => { state.liqOpen = !state.liqOpen; render(); });
  $("#liq-stock")?.addEventListener("input", (e) => { state.liqStock = e.target.value.replace(/[^0-9.]/g, ""); });
  $("#liq-usdg")?.addEventListener("input", (e) => { state.liqUsdg = e.target.value.replace(/[^0-9.]/g, ""); });
  $("#liq-btn")?.addEventListener("click", executeLiquidity);
}

const DOCS_PAGES = {
  "/docs": { title: "Perpex docs", lead: "Everything you need to swap tokenized stocks on Robinhood Chain testnet.", render: docsOverview },
  "/docs/how-to-use": { title: "How to use Perpex Swap", lead: "Connect, pick a stock, swap.", render: docsHowTo },
  "/docs/tokens": { title: "Tokens", lead: "Official testnet token addresses on Robinhood Chain.", render: docsTokens },
  "/docs/architecture": { title: "Architecture", lead: "Constant-product AMM for tokenized stocks.", render: docsArchitecture },
  "/docs/liquidity": { title: "Liquidity", lead: "Seed pools so swaps can execute.", render: docsLiquidity },
  "/docs/contract": { title: "Contract", lead: "On-chain proof and addresses.", render: docsContract },
};

function docsNav(path) {
  const items = [
    ["/docs", "Overview"],
    ["/docs/how-to-use", "How to use"],
    ["/docs/tokens", "Tokens"],
    ["/docs/architecture", "Architecture"],
    ["/docs/liquidity", "Liquidity"],
    ["/docs/contract", "Contract"],
  ];
  return items.map(([href, label]) =>
    `<a href="#${href}" class="docs-nav-item ${path === href ? "active" : ""}">${label}</a>`
  ).join("");
}

function renderDocs() {
  const path = route();
  const page = DOCS_PAGES[path] || DOCS_PAGES["/docs"];

  renderShell(`
    <div class="docs">
      <div class="docs-hero">
        <h1 class="docs-title">${page.title}</h1>
        <p class="docs-lead">${page.lead}</p>
      </div>
      <div class="docs-layout">
        <aside class="docs-sidebar">
          ${docsNav(path in DOCS_PAGES ? path : "/docs")}
          <div class="docs-sidebar-card">
            <div class="docs-sidebar-label">Testnet</div>
            <a href="${LINKS.ethFaucet}" target="_blank" rel="noreferrer">ETH faucet</a>
            <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">Paxos USDG faucet</a>
            <a href="${CHAIN.explorer}" target="_blank" rel="noreferrer">Block explorer</a>
            <a href="${LINKS.docs}" target="_blank" rel="noreferrer">Robinhood Chain docs</a>
          </div>
        </aside>
        <article class="docs-content">${page.render()}</article>
      </div>
    </div>
  `);
}

function docsOverview() {
  return `
    <p>Perpex Swap lets you exchange tokenized stocks against USDG on Robinhood Chain testnet. No sign up. Just a wallet and test tokens.</p>
    <div class="docs-callout"><strong>From the Perpex team.</strong> Same permissionless ethos as tradeperpex.fun — now for spot RWAs on Robinhood Chain.</div>
    <h2>What you need</h2>
    <ul>
      <li><strong>ETH</strong> for gas (always)</li>
      <li><strong>USDG</strong> if you want to buy a stock</li>
      <li><strong>Stock tokens</strong> if you want to sell a stock</li>
    </ul>
    <p>Get USDG from the <a href="${LINKS.paxosFaucet}" target="_blank" rel="noreferrer">Paxos testnet faucet</a>. Stock token addresses are on the <a href="#/docs/tokens">Tokens</a> page.</p>
    <h2>Quick start</h2>
    <ol class="docs-steps">
      <li class="docs-step"><span class="docs-step-num">1</span><div>Add Robinhood Chain testnet and connect your wallet.</div></li>
      <li class="docs-step"><span class="docs-step-num">2</span><div>Pick a stock: TSLA, AMZN, PLTR, NFLX, or AMD.</div></li>
      <li class="docs-step"><span class="docs-step-num">3</span><div>Enter an amount and swap.</div></li>
    </ol>
    <a href="#/" class="cta" style="display:inline-block;width:auto;padding:0.75rem 1.5rem;margin-top:0.5rem;">Open swap</a>
  `;
}

function docsHowTo() {
  return `
    <h2>Connect to the app</h2>
    <p>Add Robinhood Chain testnet to MetaMask or any EVM wallet, then connect on the <a href="#/">Swap</a> page.</p>
    <h3>Network details</h3>
    <div class="docs-table-wrap"><table class="docs-table">
      <tr><th>Property</th><th>Value</th></tr>
      <tr><td>Network</td><td>${CHAIN.name}</td></tr>
      <tr><td>Chain ID</td><td><code>${CHAIN.id}</code></td></tr>
      <tr><td>RPC</td><td><code>${CHAIN.rpc}</code></td></tr>
      <tr><td>Explorer</td><td><a href="${CHAIN.explorer}" target="_blank" rel="noreferrer">explorer.testnet.chain.robinhood.com</a></td></tr>
    </table></div>
    <h2>Swap</h2>
    <ol>
      <li>Pick a stock from the tab bar.</li>
      <li>Choose <strong>Buy</strong> (pay USDG) or <strong>Sell</strong> (pay stock).</li>
      <li>Enter an amount — the output quote updates automatically.</li>
      <li>Confirm the swap in your wallet.</li>
    </ol>
    <div class="docs-callout warn">Swaps only work when the pool has both stock and USDG. If the pool is empty, add liquidity first.</div>
  `;
}

function docsTokens() {
  return `
    <h2>USDG (quote token)</h2>
    <div class="docs-table-wrap"><table class="docs-table">
      <tr><th>Token</th><th>Address</th></tr>
      <tr><td>USDG</td><td><code>${USDG.address}</code></td></tr>
    </table></div>
    <h2>Stock tokens</h2>
    <div class="docs-table-wrap"><table class="docs-table">
      <tr><th>Symbol</th><th>Name</th><th>Address</th></tr>
      ${STOCKS.map((s) => `<tr><td>${s.symbol}</td><td>${s.name}</td><td><code>${s.address}</code></td></tr>`).join("")}
    </table></div>
  `;
}

function docsArchitecture() {
  return `
    <p>Perpex Swap is a minimal AMM for swapping tokenized stocks against USDG on Robinhood Chain testnet.</p>
    <h2>Mechanics</h2>
    <ul>
      <li>Constant-product AMM (<code>x·y=k</code>) with a <strong>0.3% swap fee</strong></li>
      <li>One pool per listed stock token paired with USDG</li>
      <li><code>swap</code> — exchange stock ↔ USDG at the pool rate</li>
      <li><code>addLiquidity</code> — deposit stock + USDG into a pool</li>
      <li><code>getPool</code> / <code>getAmountOut</code> — read reserves and quotes</li>
    </ul>
    <h2>Frontend</h2>
    <p>Static web app with ethers.js, EVM wallet connect, and direct contract calls to the on-chain swap contract.</p>
  `;
}

function docsLiquidity() {
  return `
    <p>Empty pools simply cannot trade yet. Add stock + USDG from your own wallet when you (or someone else) wants to swap that pair.</p>
    <h3>Option A: UI</h3>
    <ol>
      <li>Go to the <a href="#/provide-liquidity">Swap page</a> and expand <strong>Provide liquidity</strong>.</li>
      <li>Enter amounts for the stock and USDG, then confirm.</li>
    </ol>
    <h3>Example seed</h3>
    <p>Example above seeds 0.1 TSLA and 10 USDG. Adjust amounts per pool. Repeat for each stock you want live.</p>
    <pre class="docs-code"># Foundry example (see Perpex repo)
export STOCK_AMOUNT=100000000000000000
export USDG_AMOUNT=10000000000000000000
forge script script/AddLiquidity.s.sol --broadcast</pre>
  `;
}

function docsContract() {
  return `
    <h2>On-chain proof</h2>
    <div class="docs-grid">
      <div class="docs-card"><div class="docs-card-label">Contract</div><div class="docs-card-value"><code>${CONTRACT.address}</code></div></div>
      <div class="docs-card"><div class="docs-card-label">Deploy tx</div><div class="docs-card-value"><code>${CONTRACT.deployTx.slice(0, 18)}…</code></div></div>
      <div class="docs-card"><div class="docs-card-label">Deployer</div><div class="docs-card-value"><code>${CONTRACT.deployer}</code></div></div>
      <div class="docs-card"><div class="docs-card-label">Chain ID</div><div class="docs-card-value"><code>${CHAIN.id}</code></div></div>
    </div>
    <p><a href="${CHAIN.explorer}/address/${CONTRACT.address}" target="_blank" rel="noreferrer">View on explorer →</a></p>
    <p>Source: <a href="${CONTRACT.source}" target="_blank" rel="noreferrer">Perpex on GitHub</a></p>
    <div class="docs-callout warn">Perpex Swap is a testnet demo. Stock tokens and USDG are test assets on Robinhood Chain — not affiliated with Robinhood Markets.</div>
  `;
}

function render() {
  const path = route();
  if (path.startsWith("/docs")) renderDocs();
  else renderHome();
}

async function init() {
  if (window.ethereum) {
    provider = new BrowserProvider(window.ethereum);
    try {
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length) {
        signer = await provider.getSigner();
        account = accounts[0].toLowerCase();
        await refreshBalances();
        await refreshPool();
      }
    } catch { /* no-op */ }

    window.ethereum.on?.("accountsChanged", (accounts) => {
      account = accounts[0]?.toLowerCase() || null;
      signer = account ? signer : null;
      if (account) refreshBalances().then(() => render());
      else { state.balances = {}; render(); }
    });

    window.ethereum.on?.("chainChanged", () => location.reload());
  }

  render();
}

window.addEventListener("hashchange", () => {
  render();
  if (route() === "/" || route() === "/provide-liquidity") {
    refreshPool();
  }
});

init();