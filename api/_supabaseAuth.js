const { createClient } = require("@supabase/supabase-js");
const { cleanEnvValue, createHttpError } = require("./_db");

let supabaseServerClient;

function getSupabaseServerClient() {
  if (!supabaseServerClient) {
    const url = resolveSupabaseUrl();
    const key = resolveSupabasePublishableKey();

    if (!url || !key) {
      throw createHttpError(
        500,
        "Supabase Auth is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for auth features."
      );
    }

    supabaseServerClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  return supabaseServerClient;
}

async function requireSupabaseUser(req) {
  const token = extractBearerToken(req);
  if (!token) {
    throw createHttpError(401, "Please sign in to continue.");
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw createHttpError(401, "Your session is invalid or expired.", error);
  }

  return {
    accessToken: token,
    user: data.user,
  };
}

function resolveSupabaseUrl() {
  return firstEnvValue([
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
  ]);
}

function resolveSupabasePublishableKey() {
  return firstEnvValue([
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);
}

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

function firstEnvValue(names) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeRequestedRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin" || role === "member" || role === "visitor") {
    return role;
  }
  return "visitor";
}

function resolveAssignedRole(email, requestedRole) {
  const normalizedRequestedRole = normalizeRequestedRole(requestedRole);
  const allowlist = String(process.env.AUTH_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (allowlist.includes(normalizedEmail)) {
    return "admin";
  }

  if (normalizedRequestedRole === "admin") {
    return "visitor";
  }

  return normalizedRequestedRole;
}

function deriveDisplayName(user, fallbackName = "") {
  const metadata = user?.user_metadata || {};
  const candidates = [
    fallbackName,
    metadata.display_name,
    metadata.full_name,
    metadata.name,
    metadata.user_name,
    metadata.preferred_username,
    user?.email ? String(user.email).split("@")[0] : "",
  ];

  const resolved = candidates.find((value) => String(value || "").trim());
  return String(resolved || "Member").trim().slice(0, 80);
}

function deriveAvatarUrl(user) {
  const metadata = user?.user_metadata || {};
  return String(metadata.avatar_url || metadata.picture || "").trim().slice(0, 500);
}

function deriveProvider(user) {
  const appMetadata = user?.app_metadata || {};
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return String(appMetadata.provider || identities[0]?.provider || "email").trim().slice(0, 80);
}

module.exports = {
  deriveAvatarUrl,
  deriveDisplayName,
  deriveProvider,
  extractBearerToken,
  normalizeRequestedRole,
  requireSupabaseUser,
  resolveAssignedRole,
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
};
