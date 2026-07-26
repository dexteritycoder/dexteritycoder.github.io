const { createHttpError } = require("./_db");
const { requireSupabaseUser } = require("./_supabaseAuth");
const {
  ensureAccountSchema,
  getProfileByUserId,
  listUserProfiles,
  saveUserProfile,
  updateUserRole,
} = require("./_userProfiles");

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Admin-Users-Request-Id", requestId);

  try {
    await ensureAccountSchema();
    const auth = await requireSupabaseUser(req);
    const actorProfile = await saveUserProfile(auth.user, {});
    requireAdmin(actorProfile);

    if (req.method === "GET") {
      const profiles = await listUserProfiles();
      return sendJson(res, 200, { profiles, requestId });
    }

    if (req.method === "POST") {
      const body = normalizeBody(req.body);
      const targetUserId = String(body.userId || "").trim();
      const nextRole = String(body.role || "").trim().toLowerCase();

      if (!targetUserId) {
        throw createHttpError(400, "Choose a user to update.");
      }

      if (targetUserId === actorProfile.userId && nextRole !== "admin") {
        throw createHttpError(400, "You cannot remove your own admin access.");
      }

      const currentTarget = await getProfileByUserId(targetUserId);
      if (!currentTarget) {
        throw createHttpError(404, "That user profile could not be found.");
      }

      const profile = await updateUserRole({
        targetUserId,
        role: nextRole,
      });

      const profiles = await listUserProfiles();
      return sendJson(res, 200, { profile, profiles, requestId });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed.", requestId });
  } catch (error) {
    console.error("[admin-users-api] request.failure", {
      requestId,
      message: error?.message || "Unknown error",
      stack: error?.stack || "",
    });
    return sendJson(res, getErrorStatus(error), {
      error: error?.message || "Internal server error.",
      requestId,
    });
  }
};

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    throw createHttpError(403, "Only admins can manage member access.");
  }
}

function normalizeBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw createHttpError(400, "Request body must be valid JSON.", error);
    }
  }

  if (typeof body !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  return body;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function getErrorStatus(error) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  if (statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }
  return 500;
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
