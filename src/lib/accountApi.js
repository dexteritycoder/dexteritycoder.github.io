import { getSupabaseClient } from "./supabaseClient";

export async function fetchAccountProfile() {
  return requestAccount("/api/account", {
    method: "GET",
  });
}

export async function saveAccountProfile(payload) {
  return requestAccount("/api/account", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function requestAccount(url, options) {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw createAccountError("Please sign in to continue.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw createAccountError(payload?.error || "Could not load your account.", payload?.requestId || "");
  }

  return payload?.profile || null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createAccountError(message, requestId = "") {
  const error = new Error(message);
  error.requestId = requestId;
  return error;
}
