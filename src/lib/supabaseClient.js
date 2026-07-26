import { createClient } from "@supabase/supabase-js";

let supabaseClient;
let runtimeConfig;
let runtimeConfigPromise;

export async function loadSupabaseRuntimeConfig() {
  if (runtimeConfig) {
    return runtimeConfig;
  }

  if (!runtimeConfigPromise) {
    runtimeConfigPromise = fetch("/api/auth-config", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load Supabase auth configuration.");
        }

        const payload = await response.json();
        runtimeConfig = {
          url: String(payload?.url || "").trim(),
          publishableKey: String(payload?.publishableKey || "").trim(),
          avatarBucket: String(payload?.avatarBucket || "avatars").trim() || "avatars",
        };
        return runtimeConfig;
      })
      .catch((error) => {
        runtimeConfigPromise = undefined;
        throw error;
      });
  }

  return runtimeConfigPromise;
}

export function getSupabaseClient() {
  if (!supabaseClient) {
    const url = resolveSupabaseUrl();
    const key = resolveSupabasePublishableKey();

    if (!url || !key) {
      throw new Error(
        "Supabase auth is not configured. Add a Supabase URL and publishable key in your deployed environment."
      );
    }

    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseClient;
}

export function resolveSupabaseUrl() {
  return String(runtimeConfig?.url || import.meta.env.VITE_SUPABASE_URL || "").trim();
}

export function resolveSupabasePublishableKey() {
  return String(
    runtimeConfig?.publishableKey ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      ""
  ).trim();
}

export function getAuthRedirectUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.origin}/auth/callback`;
}

export function resolveAvatarBucketName() {
  return String(
    runtimeConfig?.avatarBucket ||
      import.meta.env.VITE_SUPABASE_AVATAR_BUCKET ||
      "avatars"
  ).trim() || "avatars";
}

export function getPendingRequestedRole() {
  if (typeof window === "undefined") {
    return "visitor";
  }

  return String(window.localStorage.getItem("dexteritycoder-pending-role") || "visitor");
}

export function setPendingRequestedRole(role) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("dexteritycoder-pending-role", String(role || "visitor"));
}

export function clearPendingRequestedRole() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem("dexteritycoder-pending-role");
}
