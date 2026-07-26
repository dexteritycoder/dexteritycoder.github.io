const { createHttpError, getPool } = require("./_db");
const {
  deriveAvatarUrl,
  deriveDisplayName,
  deriveProvider,
  normalizeRequestedRole,
  resolveAssignedRole,
} = require("./_supabaseAuth");

let schemaReadyPromise;

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

async function getProfileByUserId(userId) {
  const db = getPool();
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
    [String(userId || "").trim()]
  );

  return mapProfileRow(result.rows[0] || null);
}

async function saveUserProfile(user, updates) {
  const db = getPool();
  const requestedRole = normalizeRequestedRole(updates.requestedRole || user?.user_metadata?.requested_role);
  const existingProfile = await getProfileByUserId(user?.id);
  const role = resolveStoredRole({
    email: user?.email,
    requestedRole,
    existingRole: existingProfile?.role,
  });
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
      String(user?.id || "").trim(),
      String(user?.email || "").trim().slice(0, 160),
      displayName,
      avatarUrl,
      role,
      requestedRole,
      provider,
      newsletterSubscribed,
    ]
  );

  const savedProfile = await getProfileByUserId(user?.id);
  if (!savedProfile) {
    throw createHttpError(500, "Could not load the user profile after saving it.");
  }

  return savedProfile;
}

async function listUserProfiles() {
  const db = getPool();
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
      ORDER BY
        CASE role
          WHEN 'admin' THEN 0
          WHEN 'member' THEN 1
          ELSE 2
        END,
        LOWER(display_name) ASC,
        LOWER(email) ASC
    `
  );

  return result.rows.map((row) => mapProfileRow(row));
}

async function listAdminRequests() {
  const db = getPool();
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
      WHERE requested_role = 'admin'
        AND role <> 'admin'
      ORDER BY updated_at DESC, created_at DESC
    `
  );

  return result.rows.map((row) => mapProfileRow(row));
}

async function updateUserRole({ targetUserId, role }) {
  const db = getPool();
  const nextRole = normalizeRequestedRole(role);
  const normalizedUserId = String(targetUserId || "").trim();

  if (!normalizedUserId) {
    throw createHttpError(400, "A user ID is required.");
  }

  const result = await db.query(
    `
      UPDATE user_profiles
      SET role = $2, updated_at = NOW()
      WHERE user_id = $1
      RETURNING
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
    `,
    [normalizedUserId, nextRole]
  );

  const updatedProfile = mapProfileRow(result.rows[0] || null);
  if (!updatedProfile) {
    throw createHttpError(404, "That user profile could not be found.");
  }

  return updatedProfile;
}

function resolveStoredRole({ email, requestedRole, existingRole }) {
  const allowlistedRole = resolveAssignedRole(email, requestedRole);
  if (allowlistedRole === "admin") {
    return "admin";
  }

  if (existingRole === "admin" || existingRole === "member" || existingRole === "visitor") {
    return existingRole;
  }

  return allowlistedRole;
}

function mapProfileRow(row) {
  if (!row) {
    return null;
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

module.exports = {
  ensureAccountSchema,
  getProfileByUserId,
  listAdminRequests,
  listUserProfiles,
  saveUserProfile,
  updateUserRole,
};
