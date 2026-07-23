const EMPTY_STATS = {
  likeCount: 0,
  commentCount: 0,
  likedBy: [],
  comments: [],
};

const FALLBACK_STORAGE_KEY = "dexteritycoder-engagement-fallback-v1";

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

    const stats = payload?.stats || {};
    persistFallbackStats(stats);
    return stats;
  } catch {
    return loadFallbackStats();
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
      throw new Error(result?.error || "Failed to save engagement data.");
    }

    const stats = result?.stats || {};
    persistFallbackStats(stats);
    return stats;
  } catch {
    const fallbackStats = applyFallbackAction(payload);
    persistFallbackStats(fallbackStats);
    return fallbackStats;
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

function loadFallbackStats() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistFallbackStats(stats) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore local storage write failures.
  }
}

function applyFallbackAction(payload) {
  const currentStats = loadFallbackStats();
  const key = entityKey(payload.entityType, payload.entityId);
  const entityStats = currentStats[key] || {
    likeCount: 0,
    commentCount: 0,
    likedBy: [],
    comments: [],
  };

  if (payload.action === "toggle-like") {
    const likedBy = Array.isArray(entityStats.likedBy) ? [...entityStats.likedBy] : [];
    const existingIndex = likedBy.findIndex((entry) => entry.actorId === payload.actorId);

    if (existingIndex >= 0) {
      likedBy.splice(existingIndex, 1);
    } else {
      likedBy.unshift({
        actorId: payload.actorId,
        actorName: payload.actorName,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      ...currentStats,
      [key]: {
        ...entityStats,
        likeCount: likedBy.length,
        likedBy,
      },
    };
  }

  if (payload.action === "comment") {
    const comments = Array.isArray(entityStats.comments) ? [...entityStats.comments] : [];
    comments.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      actorId: payload.actorId,
      authorName: payload.authorName,
      authorEmail: payload.authorEmail || "",
      message: payload.message,
      createdAt: new Date().toISOString(),
    });

    return {
      ...currentStats,
      [key]: {
        ...entityStats,
        commentCount: comments.length,
        comments,
      },
    };
  }

  return currentStats;
}
