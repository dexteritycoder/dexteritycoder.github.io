const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { get, put, BlobNotFoundError } = require("@vercel/blob");

const COMMENTS_PATH = "data/engagement/comments.json";
const LIKES_PATH = "data/engagement/likes.json";
const VIEWS_PATH = "data/engagement/views.json";
const COMMENTS_BLOB_PATH = "engagement/comments.json";
const LIKES_BLOB_PATH = "engagement/likes.json";
const VIEWS_BLOB_PATH = "engagement/views.json";
const DEFAULT_VIEW_COUNTS = {
  "blog:How to Make our own Jarvis with the help of python": 920,
  "blog:When Hosting Became Business, Creativity Was Buried": 680,
  "blog:Why Learning from Scratch Still Matters in the Age of AI": 980,
  "article:production-projects": 870,
  "article:ai-machine-learning": 730,
  "article:train-to-thoughts": 960,
  "article:available-for-freelancing": 540,
  "project:Offline Music Library System": 610,
  "project:Hand-Gesture-Recognition---Major-Project-2026-BCA-": 760,
};
const DEFAULT_LIKE_COUNTS = {
  "blog:How to Make our own Jarvis with the help of python": 34,
  "blog:When Hosting Became Business, Creativity Was Buried": 22,
  "blog:Why Learning from Scratch Still Matters in the Age of AI": 41,
  "article:production-projects": 36,
  "article:ai-machine-learning": 27,
  "article:train-to-thoughts": 44,
  "article:available-for-freelancing": 20,
  "project:Offline Music Library System": 25,
  "project:Hand-Gesture-Recognition---Major-Project-2026-BCA-": 31,
};
const DEFAULT_COMMENT_COUNTS = {
  "blog:How to Make our own Jarvis with the help of python": 0,
  "blog:When Hosting Became Business, Creativity Was Buried": 0,
  "blog:Why Learning from Scratch Still Matters in the Age of AI": 0,
  "article:production-projects": 0,
  "article:ai-machine-learning": 0,
  "article:train-to-thoughts": 0,
  "article:available-for-freelancing": 0,
  "project:Offline Music Library System": 0,
  "project:Hand-Gesture-Recognition---Major-Project-2026-BCA-": 0,
};
const LEGACY_PLACEHOLDER_LIKE_COUNTS = {
  "blog:How to Make our own Jarvis with the help of python": 256,
  "blog:When Hosting Became Business, Creativity Was Buried": 175,
  "blog:Why Learning from Scratch Still Matters in the Age of AI": 312,
  "article:production-projects": 23700,
  "article:ai-machine-learning": 14800,
  "article:train-to-thoughts": 67400,
  "article:available-for-freelancing": 5,
};
const LEGACY_PLACEHOLDER_COMMENT_COUNTS = {
  "blog:How to Make our own Jarvis with the help of python": 32,
  "blog:When Hosting Became Business, Creativity Was Buried": 18,
  "blog:Why Learning from Scratch Still Matters in the Age of AI": 45,
};

let pool;
let schemaReadyPromise;
let blobAccessMode;

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Engagement-Request-Id", requestId);

  try {
    const storage = getStorageMode();
    logInfo("request.start", {
      requestId,
      method: req.method,
      url: req.url || "",
      storage,
    });

    if (req.method === "GET") {
      const state = await loadStateByMode(storage);
      logInfo("request.success", {
        requestId,
        method: req.method,
        storage,
        entityCount: countStateEntities(state),
      });
      return sendStateResponse(res, 200, storage, state, requestId);
    }

    if (req.method === "POST") {
      const body = normalizeBody(req.body);
      const action = normalizeAction(body);

      if (storage === "degraded") {
        return sendJson(res, 503, {
          error:
            "Persistent storage is not configured for this deployment. Connect Vercel Postgres or Vercel Blob to make comments and likes shared across visitors.",
          storage,
          requestId,
        });
      }

      if (action === "toggle-like") {
        const state = await handleToggleLikeByMode(storage, body);
        logInfo("request.success", {
          requestId,
          method: req.method,
          action,
          storage,
          entityType: body.entityType,
          entityId: body.entityId,
        });
        return sendStateResponse(res, 200, storage, state, requestId);
      }

      if (action === "comment") {
        const state = await handleCreateCommentByMode(storage, body);
        logInfo("request.success", {
          requestId,
          method: req.method,
          action,
          storage,
          entityType: body.entityType,
          entityId: body.entityId,
        });
        return sendStateResponse(res, 200, storage, state, requestId);
      }

      if (action === "delete-comment") {
        const state = await handleDeleteCommentByMode(storage, body);
        logInfo("request.success", {
          requestId,
          method: req.method,
          action,
          storage,
          entityType: body.entityType,
          entityId: body.entityId,
          commentId: body.commentId,
        });
        return sendStateResponse(res, 200, storage, state, requestId);
      }

      if (action === "increment-view") {
        const state = await handleIncrementViewByMode(storage, body);
        logInfo("request.success", {
          requestId,
          method: req.method,
          action,
          storage,
          entityType: body.entityType,
          entityId: body.entityId,
        });
        return sendStateResponse(res, 200, storage, state, requestId);
      }

      logInfo("request.unsupported_action", {
        requestId,
        receivedAction: body.action,
        normalizedAction: action,
      });
      throw createHttpError(400, "Unsupported engagement action.");
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed.", requestId });
  } catch (error) {
    const status = getErrorStatus(error);
    logError("request.failure", error, {
      requestId,
      method: req.method,
      url: req.url || "",
    });
    return sendJson(res, status, {
      error: getPublicErrorMessage(error, status),
      requestId,
    });
  }
};

function getStorageMode() {
  if (!process.env.VERCEL) {
    return "file";
  }
  if (hasDatabaseConfig()) {
    return "database";
  }
  if (hasBlobConfig()) {
    return "blob";
  }
  return "degraded";
}

async function loadStateByMode(storage) {
  if (storage === "database") {
    return loadStateFromDatabase();
  }
  if (storage === "blob") {
    return loadStateFromBlob();
  }
  return loadStateFromFiles();
}

async function handleToggleLikeByMode(storage, body) {
  if (storage === "database") {
    return handleToggleLikeInDatabase(body);
  }
  if (storage === "blob") {
    return handleToggleLikeInBlob(body);
  }
  return handleToggleLikeInFiles(body);
}

async function handleCreateCommentByMode(storage, body) {
  if (storage === "database") {
    return handleCreateCommentInDatabase(body);
  }
  if (storage === "blob") {
    return handleCreateCommentInBlob(body);
  }
  return handleCreateCommentInFiles(body);
}

async function handleDeleteCommentByMode(storage, body) {
  if (storage === "database") {
    return handleDeleteCommentInDatabase(body);
  }
  if (storage === "blob") {
    return handleDeleteCommentInBlob(body);
  }
  return handleDeleteCommentInFiles(body);
}

async function handleIncrementViewByMode(storage, body) {
  if (storage === "database") {
    return handleIncrementViewInDatabase(body);
  }
  if (storage === "blob") {
    return handleIncrementViewInBlob(body);
  }
  return handleIncrementViewInFiles(body);
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

  return loadStateFromFiles();
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

  return loadStateFromFiles();
}

async function handleDeleteCommentInFiles(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const commentId = cleanRequired(body.commentId, "Comment ID is required.");
  const commentsState = await loadCommentStateFromFile();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureEntityRecord(commentsState.entities, key);
  const nextEntries = entity.entries.filter((entry) => entry.id !== commentId);

  if (nextEntries.length === entity.entries.length) {
    throw createHttpError(404, "Comment not found.");
  }

  entity.entries = nextEntries;
  commentsState.entities[key] = entity;
  commentsState.updatedAt = new Date().toISOString();
  await saveDatasetToFile(COMMENTS_PATH, commentsState);

  return loadStateFromFiles();
}

async function handleIncrementViewInFiles(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const viewsState = await loadViewStateFromFile();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureCountEntityRecord(viewsState.entities, key);
  entity.count += 1;
  viewsState.entities[key] = entity;
  viewsState.updatedAt = new Date().toISOString();
  await saveDatasetToFile(VIEWS_PATH, viewsState);
  return loadStateFromFiles();
}

async function handleToggleLikeInBlob(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const actorName = cleanRequired(body.actorName, "Actor name is required.");
  const likeState = await loadLikeStateFromBlob();
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
  await saveDatasetToBlob(LIKES_BLOB_PATH, likeState);

  return loadStateFromBlob();
}

async function handleCreateCommentInBlob(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const actorId = cleanRequired(body.actorId, "Actor ID is required.");
  const authorName = cleanRequired(body.authorName, "Author name is required.");
  const authorEmail = cleanOptional(body.authorEmail, 160);
  const message = cleanRequired(body.message, "Comment is required.", 2000);
  const commentsState = await loadCommentStateFromBlob();
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
  await saveDatasetToBlob(COMMENTS_BLOB_PATH, commentsState);

  return loadStateFromBlob();
}

async function handleDeleteCommentInBlob(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const commentId = cleanRequired(body.commentId, "Comment ID is required.");
  const commentsState = await loadCommentStateFromBlob();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureEntityRecord(commentsState.entities, key);
  const nextEntries = entity.entries.filter((entry) => entry.id !== commentId);

  if (nextEntries.length === entity.entries.length) {
    throw createHttpError(404, "Comment not found.");
  }

  entity.entries = nextEntries;
  commentsState.entities[key] = entity;
  commentsState.updatedAt = new Date().toISOString();
  await saveDatasetToBlob(COMMENTS_BLOB_PATH, commentsState);

  return loadStateFromBlob();
}

async function handleIncrementViewInBlob(body) {
  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const viewsState = await loadViewStateFromBlob();
  const key = buildEntityKey(entityType, entityId);
  const entity = ensureCountEntityRecord(viewsState.entities, key);
  entity.count += 1;
  viewsState.entities[key] = entity;
  viewsState.updatedAt = new Date().toISOString();
  await saveDatasetToBlob(VIEWS_BLOB_PATH, viewsState);
  return loadStateFromBlob();
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

  return loadStateFromDatabase();
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

  return loadStateFromDatabase();
}

async function handleDeleteCommentInDatabase(body) {
  await ensureDatabaseReady();

  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const commentId = cleanRequired(body.commentId, "Comment ID is required.");
  const entityKey = buildEntityKey(entityType, entityId);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await client.query("DELETE FROM engagement_comments WHERE id = $1 AND entity_key = $2", [
      commentId,
      entityKey,
    ]);

    if (result.rowCount === 0) {
      throw createHttpError(404, "Comment not found.");
    }

    await client.query("UPDATE engagement_entities SET updated_at = NOW() WHERE entity_key = $1", [entityKey]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return loadStateFromDatabase();
}

async function handleIncrementViewInDatabase(body) {
  await ensureDatabaseReady();

  const entityType = cleanRequired(body.entityType, "Entity type is required.");
  const entityId = cleanRequired(body.entityId, "Entity ID is required.");
  const entityKey = buildEntityKey(entityType, entityId);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await ensureEntityExists(client, entityKey, entityType, entityId);
    await client.query(
      `
        UPDATE engagement_entities
        SET legacy_view_count = legacy_view_count + 1, updated_at = NOW()
        WHERE entity_key = $1
      `,
      [entityKey]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return loadStateFromDatabase();
}

async function loadStateFromFiles() {
  const [commentsState, likesState, viewsState] = await Promise.all([
    loadCommentStateFromFile(),
    loadLikeStateFromFile(),
    loadViewStateFromFile(),
  ]);
  return { commentsState, likesState, viewsState };
}

async function loadCommentStateFromFile() {
  return loadDatasetFromFile(COMMENTS_PATH);
}

async function loadLikeStateFromFile() {
  return loadDatasetFromFile(LIKES_PATH);
}

async function loadViewStateFromFile() {
  return loadCountDatasetFromFile(VIEWS_PATH);
}

async function loadDatasetFromFile(filePath) {
  const localPath = path.join(process.cwd(), filePath);
  try {
    const localContent = await fs.readFile(localPath, "utf8");
    return ensureDatasetShape(JSON.parse(localContent));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      logInfo("file.missing", { filePath: localPath });
      return ensureDatasetShape({});
    }

    throw createHttpError(500, `Failed to read engagement dataset from ${filePath}.`, error);
  }
}

async function loadCountDatasetFromFile(filePath) {
  const dataset = await loadDatasetFromFile(filePath);
  return ensureCountDatasetShape(dataset);
}

async function saveDatasetToFile(filePath, data) {
  if (process.env.VERCEL) {
    throw new Error("This Vercel deployment does not have durable server storage configured.");
  }

  const localPath = path.join(process.cwd(), filePath);
  await fs.writeFile(localPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadStateFromBlob() {
  const [commentsState, likesState, viewsState] = await Promise.all([
    loadCommentStateFromBlob(),
    loadLikeStateFromBlob(),
    loadViewStateFromBlob(),
  ]);
  return { commentsState, likesState, viewsState };
}

async function loadCommentStateFromBlob() {
  return loadDatasetFromBlob(COMMENTS_BLOB_PATH, COMMENTS_PATH);
}

async function loadLikeStateFromBlob() {
  return loadDatasetFromBlob(LIKES_BLOB_PATH, LIKES_PATH);
}

async function loadViewStateFromBlob() {
  return loadCountDatasetFromBlob(VIEWS_BLOB_PATH, VIEWS_PATH);
}

async function loadDatasetFromBlob(blobPath, fallbackFilePath) {
  const blobJson = await getBlobJson(blobPath);
  if (blobJson) {
    return ensureDatasetShape(blobJson);
  }
  return loadDatasetFromFile(fallbackFilePath);
}

async function loadCountDatasetFromBlob(blobPath, fallbackFilePath) {
  const dataset = await loadDatasetFromBlob(blobPath, fallbackFilePath);
  return ensureCountDatasetShape(dataset);
}

async function saveDatasetToBlob(blobPath, data) {
  const access = await resolveBlobAccessMode();
  const token = resolveBlobToken();
  await put(blobPath, `${JSON.stringify(data, null, 2)}\n`, {
    access,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function getBlobJson(blobPath) {
  const access = await resolveBlobAccessMode();
  const token = resolveBlobToken();

  try {
    const blob = await get(blobPath, { access, token });
    if (!blob) {
      return null;
    }

    const response = await fetch(blob.downloadUrl || blob.url);
    if (!response.ok) {
      throw new Error(`Blob read failed with status ${response.status}.`);
    }

    return response.json();
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function resolveBlobAccessMode() {
  if (blobAccessMode) {
    return blobAccessMode;
  }

  const forcedMode = cleanEnvValue(process.env.ENGAGEMENT_BLOB_ACCESS);
  if (forcedMode === "private" || forcedMode === "public") {
    blobAccessMode = forcedMode;
    return blobAccessMode;
  }

  const token = resolveBlobToken();
  for (const access of ["private", "public"]) {
    try {
      await put("__engagement_probe__.json", '{"ok":true}\n', {
        access,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      blobAccessMode = access;
      return blobAccessMode;
    } catch {
      // Try the next access mode.
    }
  }

  throw new Error("Blob storage is configured, but its access mode could not be resolved.");
}

async function ensureDatabaseReady() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = initializeDatabase().catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }
  return schemaReadyPromise;
}

async function initializeDatabase() {
  const db = getPool();
  logInfo("database.initialize.start", {
    connection: summarizeConnectionString(resolveDatabaseConnectionString()),
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS engagement_entities (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      legacy_view_count INTEGER NOT NULL DEFAULT 0,
      legacy_comment_count INTEGER NOT NULL DEFAULT 0,
      legacy_like_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE engagement_entities
    ADD COLUMN IF NOT EXISTS legacy_view_count INTEGER NOT NULL DEFAULT 0
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
    await normalizePlaceholderEngagementData(db);
    logInfo("database.initialize.ready", {
      seeded: false,
      entityCount: seedCheck.rows[0].count,
    });
    return;
  }

  await seedFromLegacyFiles();
  await normalizePlaceholderEngagementData(db);
  logInfo("database.initialize.ready", {
    seeded: true,
  });
}

async function normalizePlaceholderEngagementData(db) {
  for (const [entityKey, defaultViews] of Object.entries(DEFAULT_VIEW_COUNTS)) {
    await db.query(
      `
        UPDATE engagement_entities
        SET legacy_view_count = $2
        WHERE entity_key = $1
          AND (legacy_view_count = 0 OR legacy_view_count IS NULL)
      `,
      [entityKey, defaultViews]
    );
  }

  for (const [entityKey, placeholderLikes] of Object.entries(LEGACY_PLACEHOLDER_LIKE_COUNTS)) {
    await db.query(
      `
        UPDATE engagement_entities
        SET legacy_like_count = $2
        WHERE entity_key = $1
          AND legacy_like_count = $3
      `,
      [entityKey, DEFAULT_LIKE_COUNTS[entityKey], placeholderLikes]
    );
  }

  for (const [entityKey, placeholderComments] of Object.entries(LEGACY_PLACEHOLDER_COMMENT_COUNTS)) {
    await db.query(
      `
        UPDATE engagement_entities
        SET legacy_comment_count = $2
        WHERE entity_key = $1
          AND legacy_comment_count = $3
      `,
      [entityKey, DEFAULT_COMMENT_COUNTS[entityKey], placeholderComments]
    );
  }

  await db.query(
    `
      DELETE FROM engagement_comments
      WHERE entity_key = 'article:production-projects'
        AND author_name = 'Abhinav'
        AND message = 'This is a nice article'
        AND author_email = ''
    `
  );
}

async function seedFromLegacyFiles() {
  const [commentsState, likesState, viewsState] = await Promise.all([
    loadDatasetFromFile(COMMENTS_PATH),
    loadDatasetFromFile(LIKES_PATH),
    loadCountDatasetFromFile(VIEWS_PATH),
  ]);

  const keys = new Set([
    ...Object.keys(commentsState.entities || {}),
    ...Object.keys(likesState.entities || {}),
    ...Object.keys(viewsState.entities || {}),
  ]);

  if (keys.size === 0) {
    logInfo("database.seed.skipped", {
      reason: "no-legacy-data",
    });
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    for (const key of keys) {
      const commentEntity = ensureEntityRecord(commentsState.entities, key);
      const likeEntity = ensureEntityRecord(likesState.entities, key);
      const viewEntity = ensureCountEntityRecord(viewsState.entities, key);
      const [entityType, ...entityIdParts] = String(key).split(":");
      const entityId = entityIdParts.join(":");

      await client.query(
        `
          INSERT INTO engagement_entities (
            entity_key,
            entity_type,
            entity_id,
            legacy_view_count,
            legacy_comment_count,
            legacy_like_count,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (entity_key) DO NOTHING
        `,
        [
          key,
          entityType || "article",
          entityId || key,
          Number(viewEntity.count || 0),
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
    logInfo("database.seed.completed", {
      entityCount: keys.size,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw createHttpError(500, "Failed seeding engagement data into the database.", error);
  } finally {
    client.release();
  }
}

async function loadStateFromDatabase() {
  await ensureDatabaseReady();

  const db = getPool();
  const [entitiesResult, commentsResult, likesResult] = await Promise.all([
    db.query(`
      SELECT entity_key, legacy_view_count, legacy_comment_count, legacy_like_count
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
  const viewsState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entities: {},
  };

  for (const row of entitiesResult.rows) {
    viewsState.entities[row.entity_key] = {
      count: Number(row.legacy_view_count || 0),
    };
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

  return { commentsState, likesState, viewsState };
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
    const rawConnectionString = resolveDatabaseConnectionString();
    if (!rawConnectionString) {
      throw createHttpError(
        500,
        "Database is not configured. Connect a Postgres integration to this Vercel project or add DATABASE_URL/POSTGRES_URL for the deployed environment and redeploy."
      );
    }

    const sanitizedConnectionString = sanitizeConnectionString(rawConnectionString);
    const ssl = resolveDatabaseSslConfig(rawConnectionString);
    logInfo("database.pool.create", {
      connection: summarizeConnectionString(sanitizedConnectionString),
      sslEnabled: Boolean(ssl),
      sslMode: readSslModeFromConnectionString(rawConnectionString),
    });
    pool = new Pool({
      connectionString: sanitizedConnectionString,
      ssl,
      max: Number(process.env.ENGAGEMENT_DB_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.ENGAGEMENT_DB_IDLE_TIMEOUT_MS || 5000),
      connectionTimeoutMillis: Number(process.env.ENGAGEMENT_DB_CONNECT_TIMEOUT_MS || 10000),
      allowExitOnIdle: true,
      keepAlive: true,
    });
    pool.on("error", (error) => {
      logError("database.pool.error", error);
    });
  }

  return pool;
}

function hasDatabaseConfig() {
  return Boolean(resolveDatabaseConnectionString());
}

function hasBlobConfig() {
  return Boolean(resolveBlobToken());
}

function resolveDatabaseConnectionString() {
  const directNames = [
    "POSTGRES_URL",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
  ];

  for (const name of directNames) {
    const value = cleanEnvValue(process.env[name]);
    if (value) {
      return value;
    }
  }

  const envEntries = Object.entries(process.env);
  const discoveredUrl = envEntries.find(([name, value]) => {
    if (!cleanEnvValue(value)) {
      return false;
    }

    return (
      /(?:^|_)(?:DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|SUPABASE_DB_URL|SUPABASE_DATABASE_URL|SUPABASE_POSTGRES_URL)$/i.test(name) ||
      /^postgres(?:ql)?:\/\//i.test(String(value).trim())
    );
  });
  if (discoveredUrl) {
    return String(discoveredUrl[1]).trim();
  }

  const individualConfig = buildConnectionStringFromParts();
  if (individualConfig) {
    return individualConfig;
  }

  return "";
}

function buildConnectionStringFromParts() {
  const prefixes = ["POSTGRES", "DATABASE"];

  for (const prefix of prefixes) {
    const host = cleanEnvValue(process.env[`${prefix}_HOST`]);
    const user = cleanEnvValue(process.env[`${prefix}_USER`]);
    const password = cleanEnvValue(process.env[`${prefix}_PASSWORD`]);
    const database = cleanEnvValue(process.env[`${prefix}_DATABASE`]);
    const port = cleanEnvValue(process.env[`${prefix}_PORT`]) || "5432";

    if (!host || !user || !database) {
      continue;
    }

    const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password || "")}`;
    return `postgresql://${auth}@${host}:${port}/${database}`;
  }

  return "";
}

function resolveBlobToken() {
  const directNames = ["BLOB_READ_WRITE_TOKEN"];
  for (const name of directNames) {
    const value = cleanEnvValue(process.env[name]);
    if (value) {
      return value;
    }
  }

  const discoveredToken = Object.entries(process.env).find(([name, value]) => {
    return /(?:^|_)BLOB_READ_WRITE_TOKEN$/i.test(name) && cleanEnvValue(value);
  });

  return discoveredToken ? String(discoveredToken[1]).trim() : "";
}

function cleanEnvValue(value) {
  return String(value || "").trim();
}

function shouldUseSsl(connectionString) {
  if (process.env.POSTGRES_SSL === "false") {
    return false;
  }
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function resolveDatabaseSslConfig(connectionString) {
  const sslMode = readSslModeFromConnectionString(connectionString);
  if (sslMode === "disable" || process.env.POSTGRES_SSL === "false") {
    return false;
  }

  if (!shouldUseSsl(connectionString)) {
    return false;
  }

  return {
    rejectUnauthorized: false,
  };
}

function sanitizeConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    const blockedKeys = ["sslmode", "sslcert", "sslkey", "sslrootcert"];
    for (const key of blockedKeys) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

function readSslModeFromConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    return cleanEnvValue(url.searchParams.get("sslmode")).toLowerCase();
  } catch {
    return "";
  }
}

function buildStatsMap({ commentsState, likesState, viewsState }) {
  const keys = new Set([
    ...Object.keys(commentsState.entities || {}),
    ...Object.keys(likesState.entities || {}),
    ...Object.keys(viewsState?.entities || {}),
  ]);

  const stats = {};
  for (const key of keys) {
    const commentEntity = ensureEntityRecord(commentsState.entities, key);
    const likeEntity = ensureEntityRecord(likesState.entities, key);
    const viewEntity = ensureCountEntityRecord(viewsState?.entities || {}, key);
    stats[key] = {
      viewCount: Number(viewEntity.count || 0),
      commentCount: Number(commentEntity.legacyCount || 0) + commentEntity.entries.length,
      likeCount: Number(likeEntity.legacyCount || 0) + likeEntity.entries.length,
      comments: [...commentEntity.entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      likedBy: [...likeEntity.entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  return stats;
}

function getStateUpdatedAt({ commentsState, likesState, viewsState }) {
  const timestamps = [commentsState?.updatedAt, likesState?.updatedAt, viewsState?.updatedAt]
    .map((value) => {
      const time = value ? new Date(value).getTime() : 0;
      return Number.isFinite(time) ? time : 0;
    })
    .filter(Boolean);

  if (timestamps.length === 0) {
    return new Date().toISOString();
  }

  return new Date(Math.max(...timestamps)).toISOString();
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

function ensureCountDatasetShape(data) {
  const entities = {};
  for (const [key, value] of Object.entries(data?.entities || {})) {
    entities[key] = {
      count: Number(value?.count || value?.legacyCount || 0),
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

function ensureCountEntityRecord(entities, key) {
  if (!entities[key]) {
    entities[key] = { count: 0 };
  }
  if (typeof entities[key].count !== "number") {
    entities[key].count = Number(entities[key].count || 0);
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

function normalizeAction(body) {
  const rawAction = body && typeof body === "object" ? body.action : body;
  const action = String(rawAction || "")
    .trim()
    .toLowerCase();

  if (action === "toggle-like" || action === "toggle_like" || action === "like-toggle" || action === "like") {
    return "toggle-like";
  }

  if (action === "comment" || action === "create-comment" || action === "add-comment") {
    return "comment";
  }

  if (
    action === "delete-comment" ||
    action === "delete_comment" ||
    action === "remove-comment" ||
    action === "remove_comment" ||
    action === "deletecomment" ||
    action === "removecomment"
  ) {
    return "delete-comment";
  }

  if (!action) {
    if (looksLikeDeleteCommentPayload(body)) {
      return "delete-comment";
    }
    if (looksLikeCreateCommentPayload(body)) {
      return "comment";
    }
    if (looksLikeToggleLikePayload(body)) {
      return "toggle-like";
    }
  }

  if (looksLikeDeleteCommentPayload(body) && action.includes("comment")) {
    return "delete-comment";
  }

  if (looksLikeCreateCommentPayload(body) && (action.includes("comment") || action.includes("post"))) {
    return "comment";
  }

  if (looksLikeToggleLikePayload(body) && action.includes("like")) {
    return "toggle-like";
  }

  if (action === "increment-view" || action === "increment_view" || action === "view" || action === "track-view") {
    return "increment-view";
  }

  if (looksLikeIncrementViewPayload(body) && (action.includes("view") || !action)) {
    return "increment-view";
  }

  return action;
}

function looksLikeDeleteCommentPayload(body) {
  return Boolean(body && body.entityType && body.entityId && body.commentId);
}

function looksLikeCreateCommentPayload(body) {
  return Boolean(body && body.entityType && body.entityId && body.actorId && body.authorName && body.message);
}

function looksLikeToggleLikePayload(body) {
  return Boolean(body && body.entityType && body.entityId && body.actorId && body.actorName && !body.message);
}

function looksLikeIncrementViewPayload(body) {
  return Boolean(body && body.entityType && body.entityId && !body.commentId && !body.actorId && !body.message);
}

function cleanRequired(value, message, maxLength = 160) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    throw createHttpError(400, message);
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

function sendStateResponse(res, status, storage, state, requestId) {
  return sendJson(res, status, {
    stats: buildStatsMap(state),
    storage,
    persistent: storage === "database" || storage === "blob" || storage === "file",
    updatedAt: getStateUpdatedAt(state),
    requestId,
  });
}

function countStateEntities(state) {
  const keys = new Set([
    ...Object.keys(state?.commentsState?.entities || {}),
    ...Object.keys(state?.likesState?.entities || {}),
    ...Object.keys(state?.viewsState?.entities || {}),
  ]);
  return keys.size;
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createHttpError(status, message, cause) {
  const error = new Error(message);
  error.statusCode = status;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function getErrorStatus(error) {
  const status = Number(error?.statusCode || error?.status || 500);
  if (status >= 400 && status <= 599) {
    return status;
  }
  return 500;
}

function getPublicErrorMessage(error, status) {
  if (status >= 500) {
    return error?.message || "Internal server error.";
  }
  return error?.message || "Request failed.";
}

function logInfo(event, data = {}) {
  console.log(`[engagement] ${event}`, JSON.stringify(data));
}

function logError(event, error, data = {}) {
  console.error(
    `[engagement] ${event}`,
    JSON.stringify({
      ...data,
      message: error?.message || "Unknown error",
      stack: error?.stack || "",
      cause: error?.cause?.message || "",
      code: error?.code || "",
    })
  );
}

function summarizeConnectionString(connectionString) {
  if (!connectionString) {
    return "missing";
  }

  try {
    const url = new URL(connectionString);
    const host = url.hostname || "unknown-host";
    const port = url.port || "default";
    const database = url.pathname ? url.pathname.replace(/^\//, "") : "";
    return `${url.protocol}//${host}:${port}/${database || "unknown-db"}`;
  } catch {
    return "unparseable";
  }
}
