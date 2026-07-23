const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

const COMMENTS_PATH = "data/engagement/comments.json";
const LIKES_PATH = "data/engagement/likes.json";

let pool;
let schemaReadyPromise;

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    const storage = getStorageMode();

    if (req.method === "GET") {
      const state = storage === "database" ? await loadStateFromDatabase() : await loadStateFromFiles();
      return sendJson(res, 200, { stats: buildStatsMap(state) });
    }

    if (req.method === "POST") {
      const body = normalizeBody(req.body);

      if (body.action === "toggle-like") {
        const stats = storage === "database" ? await handleToggleLikeInDatabase(body) : await handleToggleLikeInFiles(body);
        return sendJson(res, 200, { stats });
      }

      if (body.action === "comment") {
        const stats = storage === "database" ? await handleCreateCommentInDatabase(body) : await handleCreateCommentInFiles(body);
        return sendJson(res, 200, { stats });
      }

      return sendJson(res, 400, { error: "Unsupported engagement action." });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Internal server error." });
  }
};

function getStorageMode() {
  return process.env.VERCEL ? "database" : "file";
}

async function handleToggleLikeInFiles(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const actorName = cleanRequired(body.actorName, "Actor name is required.");
  const likeState = await loadLikeStateFromFile();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureEntityRecord(likeState.entities, key);

  const existingIndex = entity.entries.findIndex((entry) => entry.actorId === actorId);
  if (existingIndex >= 0) {
    entity.entries.splice(existingIndex, 1);
  } else {
    entity.entries.unshift({
      actorId,
      actorName,
      createdAt: new Date().toISOString(),
    });
  }

  likeState.entities[key] = entity;
  likeState.updatedAt = new Date().toISOString();
  await saveDatasetToFile(LIKES_PATH, likeState);

  const state = await loadStateFromFiles();
  return buildStatsMap(state);
}

async function handleCreateCommentInFiles(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const authorName = cleanRequired(body.authorName, "Author name is required.");
  const authorEmail = cleanOptional(body.authorEmail, 160);
  const message = cleanRequired(body.message, "Comment is required.", 2000);
  const commentsState = await loadCommentStateFromFile();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureEntityRecord(commentsState.entities, key);

  entity.entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    actorId,
    authorName,
    authorEmail,
    message,
    createdAt: new Date().toISOString(),
  });

  commentsState.entities[key] = entity;
  commentsState.updatedAt = new Date().toISOString();
  await saveDatasetToFile(COMMENTS_PATH, commentsState);

  const state = await loadStateFromFiles();
  return buildStatsMap(state);
}

async function handleToggleLikeInDatabase(body) {
  await ensureDatabaseReady();

  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const actorName = cleanRequired(body.actorName, "Actor name is required.");
  const entityKey = buildEntityKey(entityType, entityId);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await ensureEntityExists(client, entityKey, entityType, entityId);

    const existing = await client.query(
      "SELECT actor_id FROM engagement_likes WHERE entity_key = $1 AND actor_id = $2 LIMIT 1",
      [entityKey, actorId]
    );

    if (existing.rowCount > 0) {
      await client.query("DELETE FROM engagement_likes WHERE entity_key = $1 AND actor_id = $2", [entityKey, actorId]);
    } else {
      await client.query(
        `
          INSERT INTO engagement_likes (entity_key, actor_id, actor_name, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (entity_key, actor_id)
          DO UPDATE SET actor_name = EXCLUDED.actor_name, created_at = NOW()
        `,
        [entityKey, actorId, actorName]
      );
    }

    await client.query("UPDATE engagement_entities SET updated_at = NOW() WHERE entity_key = $1", [entityKey]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const state = await loadStateFromDatabase();
  return buildStatsMap(state);
}

async function handleCreateCommentInDatabase(body) {
  await ensureDatabaseReady();

  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const authorName = cleanRequired(body.authorName, "Author name is required.");
  const authorEmail = cleanOptional(body.authorEmail, 160);
  const message = cleanRequired(body.message, "Comment is required.", 2000);
  const entityKey = buildEntityKey(entityType, entityId);
  const commentId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await ensureEntityExists(client, entityKey, entityType, entityId);
    await client.query(
      `
        INSERT INTO engagement_comments (
          id,
          entity_key,
          actor_id,
          author_name,
          author_email,
          message,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [commentId, entityKey, actorId, authorName, authorEmail, message]
    );
    await client.query("UPDATE engagement_entities SET updated_at = NOW() WHERE entity_key = $1", [entityKey]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const state = await loadStateFromDatabase();
  return buildStatsMap(state);
}

async function loadStateFromFiles() {
  const [commentsState, likesState] = await Promise.all([loadCommentStateFromFile(), loadLikeStateFromFile()]);
  return { commentsState, likesState };
}

async function loadCommentStateFromFile() {
  return loadDatasetFromFile(COMMENTS_PATH);
}

async function loadLikeStateFromFile() {
  return loadDatasetFromFile(LIKES_PATH);
}

async function loadDatasetFromFile(filePath) {
  const localPath = path.join(process.cwd(), filePath);
  const localContent = await fs.readFile(localPath, "utf8");
  return ensureDatasetShape(JSON.parse(localContent));
}

async function saveDatasetToFile(filePath, data) {
  const localPath = path.join(process.cwd(), filePath);
  await fs.writeFile(localPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function ensureDatabaseReady() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = initializeDatabase();
  }
  return schemaReadyPromise;
}

async function initializeDatabase() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS engagement_entities (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      legacy_comment_count INTEGER NOT NULL DEFAULT 0,
      legacy_like_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS engagement_comments (
      id TEXT PRIMARY KEY,
      entity_key TEXT NOT NULL REFERENCES engagement_entities(entity_key) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS engagement_likes (
      entity_key TEXT NOT NULL REFERENCES engagement_entities(entity_key) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (entity_key, actor_id)
    )
  `);

  await db.query("CREATE INDEX IF NOT EXISTS engagement_comments_entity_idx ON engagement_comments (entity_key, created_at DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS engagement_likes_entity_idx ON engagement_likes (entity_key, created_at DESC)");

  const seedCheck = await db.query("SELECT COUNT(*)::int AS count FROM engagement_entities");
  if ((seedCheck.rows[0] && seedCheck.rows[0].count) > 0) {
    return;
  }

  await seedFromLegacyFiles();
}

async function seedFromLegacyFiles() {
  const [commentsState, likesState] = await Promise.all([
    loadDatasetFromFile(COMMENTS_PATH),
    loadDatasetFromFile(LIKES_PATH),
  ]);

  const keys = new Set([
    ...Object.keys(commentsState.entities || {}),
    ...Object.keys(likesState.entities || {}),
  ]);

  if (keys.size === 0) {
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    for (const key of keys) {
      const commentEntity = ensureEntityRecord(commentsState.entities, key);
      const likeEntity = ensureEntityRecord(likesState.entities, key);
      const [entityType, ...entityIdParts] = String(key).split(":");
      const entityId = entityIdParts.join(":");

      await client.query(
        `
          INSERT INTO engagement_entities (
            entity_key,
            entity_type,
            entity_id,
            legacy_comment_count,
            legacy_like_count,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (entity_key) DO NOTHING
        `,
        [
          key,
          entityType || "article",
          entityId || key,
          Number(commentEntity.legacyCount || 0),
          Number(likeEntity.legacyCount || 0),
        ]
      );

      for (const entry of commentEntity.entries) {
        await client.query(
          `
            INSERT INTO engagement_comments (
              id,
              entity_key,
              actor_id,
              author_name,
              author_email,
              message,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
            ON CONFLICT (id) DO NOTHING
          `,
          [
            cleanOptional(entry.id, 120) || `${key}-${Math.random().toString(36).slice(2, 10)}`,
            key,
            cleanOptional(entry.actorId, 160) || "legacy",
            cleanOptional(entry.authorName, 160) || "Guest",
            cleanOptional(entry.authorEmail, 160),
            cleanRequired(entry.message, "Comment is required.", 2000),
            normalizeTimestamp(entry.createdAt),
          ]
        );
      }

      for (const entry of likeEntity.entries) {
        const actorId = cleanOptional(entry.actorId, 160);
        if (!actorId) {
          continue;
        }

        await client.query(
          `
            INSERT INTO engagement_likes (
              entity_key,
              actor_id,
              actor_name,
              created_at
            )
            VALUES ($1, $2, $3, $4::timestamptz)
            ON CONFLICT (entity_key, actor_id)
            DO UPDATE SET actor_name = EXCLUDED.actor_name, created_at = EXCLUDED.created_at
          `,
          [key, actorId, cleanOptional(entry.actorName, 160) || "Guest", normalizeTimestamp(entry.createdAt)]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadStateFromDatabase() {
  await ensureDatabaseReady();

  const db = getPool();
  const [entitiesResult, commentsResult, likesResult] = await Promise.all([
    db.query(`
      SELECT entity_key, legacy_comment_count, legacy_like_count
      FROM engagement_entities
    `),
    db.query(`
      SELECT id, entity_key, actor_id, author_name, author_email, message, created_at
      FROM engagement_comments
      ORDER BY created_at DESC
    `),
    db.query(`
      SELECT entity_key, actor_id, actor_name, created_at
      FROM engagement_likes
      ORDER BY created_at DESC
    `),
  ]);

  const commentsState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entities: {},
  };
  const likesState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entities: {},
  };

  for (const row of entitiesResult.rows) {
    commentsState.entities[row.entity_key] = {
      legacyCount: Number(row.legacy_comment_count || 0),
      entries: [],
    };
    likesState.entities[row.entity_key] = {
      legacyCount: Number(row.legacy_like_count || 0),
      entries: [],
    };
  }

  for (const row of commentsResult.rows) {
    const entity = ensureEntityRecord(commentsState.entities, row.entity_key);
    entity.entries.push({
      id: row.id,
      actorId: row.actor_id,
      authorName: row.author_name,
      authorEmail: row.author_email,
      message: row.message,
      createdAt: normalizeTimestamp(row.created_at),
    });
  }

  for (const row of likesResult.rows) {
    const entity = ensureEntityRecord(likesState.entities, row.entity_key);
    entity.entries.push({
      actorId: row.actor_id,
      actorName: row.actor_name,
      createdAt: normalizeTimestamp(row.created_at),
    });
  }

  return { commentsState, likesState };
}

async function ensureEntityExists(client, entityKey, entityType, entityId) {
  await client.query(
    `
      INSERT INTO engagement_entities (entity_key, entity_type, entity_id, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (entity_key) DO NOTHING
    `,
    [entityKey, entityType, entityId]
  );
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Database is not configured. Add POSTGRES_URL in your Vercel project.");
    }

    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
    });
  }

  return pool;
}

function shouldUseSsl(connectionString) {
  if (process.env.POSTGRES_SSL === "false") {
    return false;
  }
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function buildStatsMap({ commentsState, likesState }) {
  const keys = new Set([
    ...Object.keys(commentsState.entities || {}),
    ...Object.keys(likesState.entities || {}),
  ]);

  const stats = {};
  for (const key of keys) {
    const commentEntity = ensureEntityRecord(commentsState.entities, key);
    const likeEntity = ensureEntityRecord(likesState.entities, key);
    stats[key] = {
      commentCount: Number(commentEntity.legacyCount || 0) + commentEntity.entries.length,
      likeCount: Number(likeEntity.legacyCount || 0) + likeEntity.entries.length,
      comments: [...commentEntity.entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      likedBy: [...likeEntity.entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  return stats;
}

function ensureDatasetShape(data) {
  const entities = {};
  for (const [key, value] of Object.entries(data?.entities || {})) {
    entities[key] = {
      legacyCount: Number(value?.legacyCount || 0),
      entries: Array.isArray(value?.entries) ? value.entries : [],
    };
  }

  return {
    version: Number(data?.version || 1),
    updatedAt: data?.updatedAt || null,
    entities,
  };
}

function ensureEntityRecord(entities, key) {
  if (!entities[key]) {
    entities[key] = { legacyCount: 0, entries: [] };
  }
  if (!Array.isArray(entities[key].entries)) {
    entities[key].entries = [];
  }
  if (typeof entities[key].legacyCount !== "number") {
    entities[key].legacyCount = Number(entities[key].legacyCount || 0);
  }
  return entities[key];
}

function buildEntityKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

function normalizeBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  return body;
}

function cleanRequired(value, message, maxLength = 160) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    throw new Error(message);
  }
  return cleaned.slice(0, maxLength);
}

function cleanOptional(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}
