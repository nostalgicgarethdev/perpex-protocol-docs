const NAV = [
  {
    group: "Introduction",
    links: [
      { href: "/", label: "About Perpex", page: "index" },
      { href: "/connecting", label: "Getting started", page: "connecting" },
    ],
  },
  {
    group: "Build",
    links: [
      { href: "/launch-market", label: "Launch a market", page: "launch-market" },
      { href: "/trading", label: "Trading guide", page: "trading" },
      { href: "/architecture", label: "Architecture", page: "architecture" },
      { href: "/api", label: "API reference", page: "api" },
    ],
  },
  {
    group: "Resources",
    links: [
      { href: "/brand", label: "Brand kit", page: "brand" },
      { href: "/report", label: "Report an issue", page: "report" },
      { href: "https://github.com/tradeperpex/tradeperpex", label: "GitHub", external: true },
    ],
  },
];

const SEARCH_INDEX = [
  { title: "About Perpex", href: "/", keywords: "perpex perpetual solana permissionless leverage" },
  { title: "Getting started", href: "/connecting", keywords: "wallet phantom solflare metamask connect demo balance" },
  { title: "Launch a market", href: "/launch-market", keywords: "create launch mint leverage fee bonding curve" },
  { title: "Trading guide", href: "/trading", keywords: "orders limit stop market long short liquidation" },
  { title: "Architecture", href: "/architecture", keywords: "nextjs postgres neon engine api positions" },
  { title: "API reference", href: "/api", keywords: "rest endpoints positions orders markets ohlcv" },
  { title: "Brand kit", href: "/brand", keywords: "logo colors banner assets" },
  { title: "Report an issue", href: "/report", keywords: "bug security vulnerability" },
];

function getCurrentPage() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/" || path.endsWith("/index.html")) return "index";
  const slug = path.split("/").pop().replace(".html", "");
  return slug || "index";
}

function renderSidebar() {
  const el = document.getElementById("sidebar-nav");
  if (!el) return;
  const current = getCurrentPage();

  el.innerHTML = NAV.map(
    (g) => `
    <div class="nav-group">
      <div class="nav-group-title">${g.group}</div>
      ${g.links
        .map((l) => {
          const active = !l.external && l.page === current;
          const attrs = l.external ? 'target="_blank" rel="noopener noreferrer"' : "";
          return `<a href="${l.href}" class="nav-link${active ? " active" : ""}" ${attrs}>
            <span class="dot"></span>${l.label}${l.external ? " ↗" : ""}
          </a>`;
        })
        .join("")}
    </div>`
  ).join("");
}

function renderToc() {
  const rail = document.getElementById("toc-rail");
  if (!rail) return;

  const headings = document.querySelectorAll(".content h2[id], .content h3[id]");
  if (!headings.length) {
    rail.style.display = "none";
    return;
  }

  const list = document.createElement("div");
  list.innerHTML = "<h4>On this page</h4>";
  headings.forEach((h) => {
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    a.style.paddingLeft = h.tagName === "H3" ? "20px" : "12px";
    list.appendChild(a);
  });
  rail.appendChild(list);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          list.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
          const active = list.querySelector(`a[href="#${e.target.id}"]`);
          if (active) active.classList.add("active");
        }
      });
    },
    { rootMargin: "-20% 0px -70% 0px" }
  );
  headings.forEach((h) => observer.observe(h));
}

function initSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  function show(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      results.classList.remove("open");
      return;
    }

    const matches = SEARCH_INDEX.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.keywords.toLowerCase().includes(query)
    );

    if (!matches.length) {
      results.innerHTML = `<div class="search-result"><span class="title">No results</span></div>`;
    } else {
      results.innerHTML = matches
        .map(
          (m) =>
            `<a class="search-result" href="${m.href}">
              <div class="title">${m.title}</div>
              <div class="path">${m.href}</div>
            </a>`
        )
        .join("");
    }
    results.classList.add("open");
  }

  input.addEventListener("input", (e) => show(e.target.value));
  input.addEventListener("focus", (e) => show(e.target.value));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) results.classList.remove("open");
  });
}

function initMobileMenu() {
  const toggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  if (!toggle || !sidebar) return;

  toggle.addEventListener("click", () => sidebar.classList.toggle("open"));
  sidebar.querySelectorAll(".nav-link").forEach((a) => {
    a.addEventListener("click", () => sidebar.classList.remove("open"));
  });
}

function addNetwork() {
  if (!window.ethereum) {
    alert("No EVM wallet detected. Add Perpex manually in your Solana wallet settings.");
    return;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar();
  renderToc();
  initSearch();
  initMobileMenu();
});