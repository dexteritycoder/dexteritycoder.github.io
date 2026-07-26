const { createHttpError } = require("./_db");
const { requireSupabaseUser } = require("./_supabaseAuth");
const { ensureAccountSchema, saveUserProfile } = require("./_userProfiles");
const engagementApi = require("./engagement");

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensureAccountSchema();
    const auth = await requireSupabaseUser(req);
    const profile = await saveUserProfile(auth.user, {});
    requireAdmin(profile);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed.", requestId });
    }

    const body = normalizeBody(req.body);
    const comments = await engagementApi.moderateCommentById({
      commentId: String(body.commentId || "").trim(),
      status: String(body.status || "").trim().toLowerCase(),
      reviewedByUserId: profile.userId,
    });

    return sendJson(res, 200, { comments, requestId });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error?.message || "Internal server error.",
      requestId,
    });
  }
};

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    throw createHttpError(403, "Only admins can moderate comments.");
  }
}

function normalizeBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  if (typeof body !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }
  return body;
}

function getErrorStatus(error) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  return statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
