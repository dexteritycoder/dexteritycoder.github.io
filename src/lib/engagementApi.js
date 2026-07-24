const EMPTY_STATS = {
  viewCount: 0,
  likeCount: 0,
  commentCount: 0,
  likedBy: [],
  comments: [],
};

const FALLBACK_STORAGE_KEY = "dexteritycoder-engagement-fallback-v1";
const EMPTY_RESPONSE = {
  stats: {},
  storage: "file",
  persistent: true,
  updatedAt: "",
  requestId: "",
};

export function entityKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

export function getEntityStats(statsMap, entityType, entityId) {
  return statsMap[entityKey(entityType, entityId)] || EMPTY_STATS;
}

export async function fetchEngagementStats() {
  try {
    const response = await fetch("/api/engagement", {
      headers: { Accept: "application/json" },
    });

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load engagement data.");
    }

    const normalized = normalizeEngagementResponse(payload);
    persistFallbackResponse(normalized);
    return normalized;
  } catch (error) {
    logClientError("fetchEngagementStats", error);
    if (error instanceof TypeError) {
      return loadFallbackResponse();
    }
    throw error;
  }
}

export async function toggleLike(payload) {
  return postEngagementAction({
    action: "toggle-like",
    ...payload,
  });
}

export async function createComment(payload) {
  return postEngagementAction({
    action: "comment",
    ...payload,
  });
}

export async function deleteComment(payload) {
  return postEngagementAction({
    action: "delete-comment",
    ...payload,
  });
}

export async function incrementView(payload) {
  return postEngagementAction({
    action: "increment-view",
    ...payload,
  });
}

async function postEngagementAction(payload) {
  try {
    const response = await fetch("/api/engagement", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await readJsonResponse(response);
    if (!response.ok) {
      throw createClientError(result?.error || "Failed to save engagement data.", {
        requestId: result?.requestId || response.headers.get("x-engagement-request-id") || "",
        status: response.status,
      });
    }

    const normalized = normalizeEngagementResponse(result);
    persistFallbackResponse(normalized);
    return normalized;
  } catch (error) {
    logClientError("postEngagementAction", error, {
      action: payload?.action || "",
      entityType: payload?.entityType || "",
      entityId: payload?.entityId || "",
    });
    throw error;
  }
}

export function formatCount(value) {
  const count = Number(value) || 0;
  if (count >= 1000000) {
    return `${trimTrailingZero((count / 1000000).toFixed(1))}M`;
  }
  if (count >= 1000) {
    return `${trimTrailingZero((count / 1000).toFixed(1))}k`;
  }
  return String(count);
}

export function parseLooseCount(value) {
  const cleaned = String(value || "")
    .replace(/[^\d.kKmM]/g, "")
    .trim();

  if (!cleaned) {
    return 0;
  }

  const suffix = cleaned.slice(-1).toLowerCase();
  const number = Number.parseFloat(cleaned);
  if (Number.isNaN(number)) {
    return 0;
  }

  if (suffix === "m") {
    return Math.round(number * 1000000);
  }
  if (suffix === "k") {
    return Math.round(number * 1000);
  }
  return Math.round(number);
}

function trimTrailingZero(value) {
  return value.replace(/\.0$/, "");
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

function loadFallbackResponse() {
  if (typeof window === "undefined") {
    return EMPTY_RESPONSE;
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    return raw ? normalizeEngagementResponse(JSON.parse(raw)) : EMPTY_RESPONSE;
  } catch {
    return EMPTY_RESPONSE;
  }
}

function persistFallbackResponse(payload) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(normalizeEngagementResponse(payload)));
  } catch {
    // Ignore local storage write failures.
  }
}

function normalizeEngagementResponse(payload) {
  return {
    stats: payload?.stats || {},
    storage: payload?.storage || "file",
    persistent: payload?.persistent !== false,
    updatedAt: payload?.updatedAt || "",
    requestId: payload?.requestId || "",
  };
}

function createClientError(message, details = {}) {
  const error = new Error(message);
  error.requestId = details.requestId || "";
  error.status = details.status || 0;
  return error;
}

function logClientError(event, error, details = {}) {
  console.error("[engagement-client]", event, {
    ...details,
    message: error?.message || "Unknown error",
    requestId: error?.requestId || "",
    status: error?.status || 0,
  });
}
