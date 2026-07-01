export default function handler(req, res) {
  const hasKey = Boolean(process.env.ALCHEMY_API_KEY);
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID || "";

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
  res.status(200).json({
    gasless: Boolean(hasKey && policyId),
    batch: true,
    policyId: policyId || null,
    hint: hasKey && policyId
      ? "Alchemy gas sponsorship active"
      : "Gas sponsorship not configured on server",
  });
}