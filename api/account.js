const { createHttpError, getPool } = require("./_db");
const {
  deriveAvatarUrl,
  deriveDisplayName,
  deriveProvider,
  normalizeRequestedRole,
  requireSupabaseUser,
  resolveAssignedRole,
} = require("./_supabaseAuth");

let schemaReadyPromise;

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Account-Request-Id", requestId);

  try {
    await ensureAccountSchema();
    const auth = await requireSupabaseUser(req);

    if (req.method === "GET") {
      const profile = await ensureUserProfile(auth.user, {});
      return sendJson(res, 200, { profile, requestId });
    }

    if (req.method === "POST") {
      const body = normalizeBody(req.body);
      const profile = await ensureUserProfile(auth.user, body);
      return sendJson(res, 200, { profile, requestId });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed.", requestId });
  } catch (error) {
    console.error("[account-api] request.failure", {
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

async function ensureAccountSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = initializeAccountSchema().catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }

  return schemaReadyPromise;
}

async function initializeAccountSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'visitor',
      requested_role TEXT NOT NULL DEFAULT 'visitor',
      auth_provider TEXT NOT NULL DEFAULT 'email',
      newsletter_subscribed BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureUserProfile(user, updates) {
  const db = getPool();
  const requestedRole = normalizeRequestedRole(updates.requestedRole || user?.user_metadata?.requested_role);
  const role = resolveAssignedRole(user?.email, requestedRole);
  const displayName = deriveDisplayName(user, updates.displayName);
  const avatarUrl = String(updates.avatarUrl || deriveAvatarUrl(user)).trim().slice(0, 500);
  const provider = deriveProvider(user);
  const newsletterSubscribed = updates.newsletterSubscribed !== false;

  await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        email,
        display_name,
        avatar_url,
        role,
        requested_role,
        auth_provider,
        newsletter_subscribed,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        role = EXCLUDED.role,
        requested_role = EXCLUDED.requested_role,
        auth_provider = EXCLUDED.auth_provider,
        newsletter_subscribed = EXCLUDED.newsletter_subscribed,
        updated_at = NOW()
    `,
    [
      user.id,
      String(user.email || "").trim().slice(0, 160),
      displayName,
      avatarUrl,
      role,
      requestedRole,
      provider,
      newsletterSubscribed,
    ]
  );

  const result = await db.query(
    `
      SELECT
        user_id,
        email,
        display_name,
        avatar_url,
        role,
        requested_role,
        auth_provider,
        newsletter_subscribed,
        created_at,
        updated_at
      FROM user_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [user.id]
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(500, "Could not load the user profile after saving it.");
  }

  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    requestedRole: row.requested_role,
    authProvider: row.auth_provider,
    newsletterSubscribed: row.newsletter_subscribed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
