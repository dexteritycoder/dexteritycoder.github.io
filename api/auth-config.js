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
  const avatarBucket = String(
    process.env.SUPABASE_AVATAR_BUCKET ||
      process.env.NEXT_PUBLIC_SUPABASE_AVATAR_BUCKET ||
      process.env.VITE_SUPABASE_AVATAR_BUCKET ||
      "avatars"
  ).trim();

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      configured: Boolean(url && publishableKey),
      url,
      publishableKey,
      avatarBucket,
    })
  );
};
