const { createHttpError } = require("./_db");
const { requireSupabaseUser } = require("./_supabaseAuth");
const { ensureAccountSchema, listAdminRequests, saveUserProfile } = require("./_userProfiles");
const { ensureContentSchema, listContent } = require("./_contentStore");
const engagementApi = require("./engagement");

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensureAccountSchema();
    await ensureContentSchema();
    const auth = await requireSupabaseUser(req);
    const profile = await saveUserProfile(auth.user, {});
    requireAdmin(profile);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "Method not allowed.", requestId });
    }

    const [roleRequests, comments, contentRequests, allContent] = await Promise.all([
      listAdminRequests(),
      engagementApi.listCommentsForAdmin(),
      listContent({ includeStatuses: ["pending"] }),
      listContent({ includeStatuses: ["pending", "approved", "rejected"] }),
    ]);

    return sendJson(res, 200, {
      roleRequests,
      comments,
      contentRequests,
      allContent,
      requestId,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error?.message || "Internal server error.",
      requestId,
    });
  }
};

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    throw createHttpError(403, "Only admins can access the dashboard.");
  }
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
