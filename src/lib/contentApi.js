import { getSupabaseClient } from "./supabaseClient";

export async function fetchPublicContent() {
  const response = await fetch("/api/content", {
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw createApiError(payload?.error || "Could not load published content.", payload?.requestId || "");
  }

  return Array.isArray(payload?.items) ? payload.items : [];
}

export async function fetchAdminDashboard() {
  return requestAuthed("/api/admin-dashboard", {
    method: "GET",
  });
}

export async function submitContentRequest(payload) {
  return requestAuthed("/api/content", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reviewContentRequest(payload) {
  return requestAuthed("/api/content", {
    method: "POST",
    body: JSON.stringify({
      action: "review",
      ...payload,
    }),
  });
}

export async function reviewCommentRequest(payload) {
  return requestAuthed("/api/admin-comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function requestAuthed(url, options) {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw createApiError("Please sign in to continue.");
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
    throw createApiError(payload?.error || "Request failed.", payload?.requestId || "");
  }

  return payload || null;
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

function createApiError(message, requestId = "") {
  const error = new Error(message);
  error.requestId = requestId;
  return error;
}
