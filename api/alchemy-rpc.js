export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Alchemy not configured" });
    return;
  }

  const endpoints = [
    `https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`,
    `https://api.g.alchemy.com/v2/${apiKey}`,
  ];

  let lastError = null;
  for (const url of endpoints) {
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await upstream.json();
      if (!data.error || upstream.ok) {
        res.status(200).json(data);
        return;
      }
      lastError = data.error;
    } catch (err) {
      lastError = err;
    }
  }

  res.status(502).json({
    error: lastError?.message || "Alchemy RPC proxy failed",
  });
}