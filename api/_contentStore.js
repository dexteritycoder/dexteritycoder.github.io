const fs = require("node:fs/promises");
const path = require("node:path");
const { createHttpError, getPool } = require("./_db");

const CONTENT_PATH = "data/admin-content/content.json";

let schemaReadyPromise;

function hasDatabaseConfig() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      process.env.SUPABASE_DATABASE_URL ||
      process.env.SUPABASE_POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING
  );
}

async function ensureContentSchema() {
  if (!hasDatabaseConfig()) {
    return ensureFileStore();
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = initializeDatabaseSchema().catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }

  return schemaReadyPromise;
}

async function initializeDatabaseSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS managed_content (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      section TEXT NOT NULL,
      target_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      hero_image TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      author_email TEXT NOT NULL DEFAULT '',
      author_role TEXT NOT NULL DEFAULT 'member',
      read_time TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL DEFAULT '',
      github_url TEXT NOT NULL DEFAULT '',
      document_title TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT '',
      cta_href TEXT NOT NULL DEFAULT '',
      request_kind TEXT NOT NULL DEFAULT 'create',
      status TEXT NOT NULL DEFAULT 'pending',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      reviewed_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `);
  await db.query(`ALTER TABLE managed_content ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE managed_content ADD COLUMN IF NOT EXISTS author_role TEXT NOT NULL DEFAULT 'member'`);
}

async function listContent({ includeStatuses = ["approved"], includeTypes = [] } = {}) {
  await ensureContentSchema();

  if (hasDatabaseConfig()) {
    const db = getPool();
    const params = [];
    const where = [];

    if (Array.isArray(includeStatuses) && includeStatuses.length > 0) {
      params.push(includeStatuses);
      where.push(`status = ANY($${params.length})`);
    }

    if (Array.isArray(includeTypes) && includeTypes.length > 0) {
      params.push(includeTypes);
      where.push(`content_type = ANY($${params.length})`);
    }

    const result = await db.query(
      `
        SELECT *
        FROM managed_content
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY updated_at DESC, created_at DESC
      `,
      params
    );

    return result.rows.map(mapContentRow);
  }

  const store = await loadFileStore();
  return store.items
    .filter((item) => matchesFilters(item, includeStatuses, includeTypes))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function saveContentItem(payload) {
  await ensureContentSchema();
  const item = normalizeContentPayload(payload);

  if (hasDatabaseConfig()) {
    const db = getPool();
    await db.query(
      `
        INSERT INTO managed_content (
          id,
          content_type,
          section,
          target_slug,
          title,
          description,
          hero_image,
          meta,
          category,
          author_name,
          author_email,
          author_role,
          read_time,
          markdown,
          github_url,
          document_title,
          cta_label,
          cta_href,
          request_kind,
          status,
          created_by_user_id,
          reviewed_by_user_id,
          created_at,
          updated_at,
          reviewed_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::timestamptz, $23::timestamptz, $24::timestamptz
        )
        ON CONFLICT (id)
        DO UPDATE SET
          content_type = EXCLUDED.content_type,
          section = EXCLUDED.section,
          target_slug = EXCLUDED.target_slug,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          hero_image = EXCLUDED.hero_image,
          meta = EXCLUDED.meta,
          category = EXCLUDED.category,
          author_name = EXCLUDED.author_name,
          author_email = EXCLUDED.author_email,
          author_role = EXCLUDED.author_role,
          read_time = EXCLUDED.read_time,
          markdown = EXCLUDED.markdown,
          github_url = EXCLUDED.github_url,
          document_title = EXCLUDED.document_title,
          cta_label = EXCLUDED.cta_label,
          cta_href = EXCLUDED.cta_href,
          request_kind = EXCLUDED.request_kind,
          status = EXCLUDED.status,
          created_by_user_id = EXCLUDED.created_by_user_id,
          reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
          updated_at = EXCLUDED.updated_at,
          reviewed_at = EXCLUDED.reviewed_at
      `,
      [
        item.id,
        item.contentType,
        item.section,
        item.targetSlug,
        item.title,
        item.description,
        item.heroImage,
        item.meta,
        item.category,
        item.authorName,
        item.authorEmail,
        item.authorRole,
        item.readTime,
        item.markdown,
        item.githubUrl,
        item.documentTitle,
        item.ctaLabel,
        item.ctaHref,
        item.requestKind,
        item.status,
        item.createdByUserId,
        item.reviewedByUserId,
        item.createdAt,
        item.updatedAt,
        item.reviewedAt || null,
      ]
    );

    const saved = await getContentById(item.id);
    if (!saved) {
      throw createHttpError(500, "Could not load the content item after saving it.");
    }
    return saved;
  }

  const store = await loadFileStore();
  const existingIndex = store.items.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    store.items[existingIndex] = item;
  } else {
    store.items.unshift(item);
  }
  store.updatedAt = new Date().toISOString();
  await saveFileStore(store);
  return item;
}

async function getContentById(id) {
  await ensureContentSchema();

  if (hasDatabaseConfig()) {
    const db = getPool();
    const result = await db.query("SELECT * FROM managed_content WHERE id = $1 LIMIT 1", [String(id || "").trim()]);
    return mapContentRow(result.rows[0] || null);
  }

  const store = await loadFileStore();
  return store.items.find((item) => item.id === id) || null;
}

async function reviewContentItem({ id, status, reviewedByUserId }) {
  const existing = await getContentById(id);
  if (!existing) {
    throw createHttpError(404, "That content request could not be found.");
  }

  const nextStatus = normalizeStatus(status);
  const now = new Date().toISOString();
  return saveContentItem({
    ...existing,
    status: nextStatus,
    reviewedByUserId: String(reviewedByUserId || "").trim(),
    reviewedAt: now,
    updatedAt: now,
  });
}

async function ensureFileStore() {
  const absolutePath = path.join(process.cwd(), CONTENT_PATH);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  try {
    await fs.access(absolutePath);
  } catch {
    await fs.writeFile(
      absolutePath,
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: [] }, null, 2),
      "utf8"
    );
  }
}

async function loadFileStore() {
  await ensureFileStore();
  const absolutePath = path.join(process.cwd(), CONTENT_PATH);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw || "{}");

  return {
    version: Number(parsed.version || 1),
    updatedAt: parsed.updatedAt || "",
    items: Array.isArray(parsed.items) ? parsed.items.map(normalizeContentPayload) : [],
  };
}

async function saveFileStore(store) {
  const absolutePath = path.join(process.cwd(), CONTENT_PATH);
  await fs.writeFile(absolutePath, JSON.stringify(store, null, 2), "utf8");
}

function normalizeContentPayload(payload) {
  const now = new Date().toISOString();
  const targetSlug =
    slugify(payload.targetSlug || payload.title || payload.id || `draft-${Date.now().toString(36)}`);

  return {
    id: String(payload.id || `${targetSlug}-${Math.random().toString(36).slice(2, 8)}`).trim(),
    contentType: normalizeContentType(payload.contentType),
    section: String(payload.section || "writings").trim().toLowerCase(),
    targetSlug,
    title: String(payload.title || "Untitled").trim().slice(0, 160),
    description: String(payload.description || "").trim().slice(0, 600),
    heroImage: String(payload.heroImage || "").trim().slice(0, 500),
    meta: String(payload.meta || "").trim().slice(0, 200),
    category: String(payload.category || "").trim().slice(0, 120),
    authorName: String(payload.authorName || "Member").trim().slice(0, 120),
    authorEmail: String(payload.authorEmail || "").trim().slice(0, 160),
    authorRole: normalizeAuthorRole(payload.authorRole),
    readTime: String(payload.readTime || "").trim().slice(0, 80),
    markdown: String(payload.markdown || "").trim(),
    githubUrl: String(payload.githubUrl || "").trim().slice(0, 500),
    documentTitle: String(payload.documentTitle || "").trim().slice(0, 160),
    ctaLabel: String(payload.ctaLabel || "").trim().slice(0, 120),
    ctaHref: String(payload.ctaHref || "").trim().slice(0, 240),
    requestKind: normalizeRequestKind(payload.requestKind),
    status: normalizeStatus(payload.status),
    createdByUserId: String(payload.createdByUserId || "").trim().slice(0, 160),
    reviewedByUserId: String(payload.reviewedByUserId || "").trim().slice(0, 160),
    createdAt: payload.createdAt || now,
    updatedAt: payload.updatedAt || now,
    reviewedAt: payload.reviewedAt || "",
  };
}

function normalizeContentType(value) {
  const contentType = String(value || "").trim().toLowerCase();
  if (contentType === "blog" || contentType === "project" || contentType === "page") {
    return contentType;
  }
  return "blog";
}

function normalizeRequestKind(value) {
  const requestKind = String(value || "").trim().toLowerCase();
  if (requestKind === "edit") {
    return "edit";
  }
  return "create";
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "approved" || status === "rejected" || status === "pending") {
    return status;
  }
  return "pending";
}

function normalizeAuthorRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin" || role === "member") {
    return role;
  }
  return "member";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}

function mapContentRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    contentType: row.content_type,
    section: row.section,
    targetSlug: row.target_slug,
    title: row.title,
    description: row.description,
    heroImage: row.hero_image,
    meta: row.meta,
    category: row.category,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorRole: normalizeAuthorRole(row.author_role),
    readTime: row.read_time,
    markdown: row.markdown,
    githubUrl: row.github_url,
    documentTitle: row.document_title,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    requestKind: row.request_kind,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

function matchesFilters(item, includeStatuses, includeTypes) {
  const statusMatch = !Array.isArray(includeStatuses) || includeStatuses.length === 0 || includeStatuses.includes(item.status);
  const typeMatch = !Array.isArray(includeTypes) || includeTypes.length === 0 || includeTypes.includes(item.contentType);
  return statusMatch && typeMatch;
}

module.exports = {
  ensureContentSchema,
  getContentById,
  listContent,
  reviewContentItem,
  saveContentItem,
  slugify,
};
