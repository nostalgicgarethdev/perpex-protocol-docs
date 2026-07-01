import { getBrand } from "./network.js";

const W = 1200;
const H = 630;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderShareCard(data) {
  const BRAND = getBrand();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#f7f5f2");
  bg.addColorStop(0.5, "#f0ebe5");
  bg.addColorStop(1, "#e8dfd6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  roundRect(ctx, 48, 48, W - 96, H - 96, 32);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(201,111,82,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#5c4033";
  ctx.font = "700 52px system-ui, -apple-system, sans-serif";
  ctx.fillText(BRAND.name, 96, 130);

  ctx.fillStyle = "#c96f52";
  ctx.font = "600 22px system-ui, -apple-system, sans-serif";
  ctx.fillText("Robinhood Chain · Equity Terminal", 96, 168);

  ctx.fillStyle = "#1f2937";
  ctx.font = "800 64px system-ui, -apple-system, sans-serif";
  const route = data.side === "buy"
    ? `USDG → ${data.stock}`
    : `${data.stock} → USDG`;
  ctx.fillText(route, 96, 270);

  ctx.font = "500 34px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(`${data.amountIn} ${data.tokenIn}  →  ${data.amountOut} ${data.tokenOut}`, 96, 340);

  if (data.price) {
    ctx.font = "500 28px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`Mid · $${data.price} · Impact ${data.impact || "—"}%`, 96, 395);
  }

  if (data.vol24h) {
    ctx.fillText(`24h lane vol · $${data.vol24h.toLocaleString()} USDG`, 96, 435);
  }

  roundRect(ctx, 96, 470, W - 192, 72, 16);
  ctx.fillStyle = "rgba(34,197,94,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(34,197,94,0.35)";
  ctx.stroke();
  ctx.fillStyle = "#166534";
  ctx.font = "600 22px 'JetBrains Mono', monospace";
  const ca = BRAND.tokenCa || "";
  ctx.fillText(ca ? `CA ${ca}` : BRAND.url, 120, 518);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "500 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(BRAND.url.replace("https://", ""), 96, H - 72);

  return canvas;
}

export async function downloadShareCard(data, filename = "tickerflux-route.png") {
  const canvas = await renderShareCard(data);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return blob;
}

export async function shareRouteCard(data) {
  const canvas = await renderShareCard(data);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "tickerflux-route.png", { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: "TickerFlux route",
        text: `Routed on TickerFlux: ${data.amountIn} ${data.tokenIn} → ${data.amountOut} ${data.tokenOut}`,
        files: [file],
      });
      return true;
    } catch {
      /* fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tickerflux-route.png";
  a.click();
  URL.revokeObjectURL(url);
  return true;
}