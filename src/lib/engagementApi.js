const EMPTY_STATS = {
  likeCount: 0,
  commentCount: 0,
  likedBy: [],
  comments: [],
};

export function entityKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

export function getEntityStats(statsMap, entityType, entityId) {
  return statsMap[entityKey(entityType, entityId)] || EMPTY_STATS;
}

export async function fetchEngagementStats() {
  const response = await fetch("/api/engagement", {
    headers: { Accept: "application/json" },
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load engagement data.");
  }

  return payload?.stats || {};
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

  return result?.stats || {};
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
