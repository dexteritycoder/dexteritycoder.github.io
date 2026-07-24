import { createClient } from "@supabase/supabase-js";

let supabaseClient;

export function getSupabaseClient() {
  if (!supabaseClient) {
    const url = resolveSupabaseUrl();
    const key = resolveSupabasePublishableKey();

    if (!url || !key) {
      throw new Error(
        "Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY."
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
  return String(import.meta.env.VITE_SUPABASE_URL || "").trim();
}

export function resolveSupabasePublishableKey() {
  return String(
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
