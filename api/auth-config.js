const {
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
} = require("./_supabaseAuth");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const url = resolveSupabaseUrl();
  const publishableKey = resolveSupabasePublishableKey();

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      configured: Boolean(url && publishableKey),
      url,
      publishableKey,
    })
  );
};
