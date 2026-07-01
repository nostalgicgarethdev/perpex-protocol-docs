export default function handler(req, res) {
  const alchemyKey = process.env.ALCHEMY_API_KEY || "";
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID || "";
  const paymasterUrl = alchemyKey && policyId
    ? `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : null;

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
  res.status(200).json({
    gasless: Boolean(paymasterUrl && policyId),
    batch: true,
    paymasterUrl: paymasterUrl && policyId ? paymasterUrl : null,
    policyId: policyId ? "configured" : null,
    hint: paymasterUrl
      ? "Alchemy gas sponsorship active"
      : "Set ALCHEMY_API_KEY + ALCHEMY_GAS_POLICY_ID on Vercel for sponsored gas",
  });
}