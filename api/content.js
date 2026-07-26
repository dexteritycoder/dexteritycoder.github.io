const { createHttpError } = require("./_db");
const { requireSupabaseUser } = require("./_supabaseAuth");
const { getProfileByUserId, saveUserProfile, ensureAccountSchema } = require("./_userProfiles");
const { ensureContentSchema, listContent, reviewContentItem, saveContentItem, slugify } = require("./_contentStore");

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensureAccountSchema();
    await ensureContentSchema();

    if (req.method === "GET") {
      const scope = String(req.query?.scope || getQueryValue(req.url, "scope") || "public").trim().toLowerCase();
      if (scope === "admin") {
        const auth = await requireSupabaseUser(req);
        const profile = await saveUserProfile(auth.user, {});
        requireAdmin(profile);
        const items = await listContent({ includeStatuses: ["pending", "approved", "rejected"] });
        return sendJson(res, 200, { items, requestId });
      }

      const items = await listContent({ includeStatuses: ["approved"] });
      return sendJson(res, 200, { items, requestId });
    }

    if (req.method === "POST") {
      const auth = await requireSupabaseUser(req);
      const profile = await saveUserProfile(auth.user, {});
      const body = normalizeBody(req.body);
      const action = String(body.action || "submit").trim().toLowerCase();

      if (action === "review") {
        requireAdmin(profile);
        const item = await reviewContentItem({
          id: String(body.id || "").trim(),
          status: String(body.status || "").trim().toLowerCase(),
          reviewedByUserId: profile.userId,
        });
        const items = await listContent({ includeStatuses: ["pending", "approved", "rejected"] });
        return sendJson(res, 200, { item, items, requestId });
      }

      const section = String(body.section || "writings").trim().toLowerCase();
      const contentType = normalizeContentType(body.contentType, section);
      const isAdmin = profile.role === "admin";
      const targetSlug = slugify(body.targetSlug || body.title || body.id);
      const existing = body.id ? await getExisting(body.id) : null;
      const item = await saveContentItem({
        id: existing?.id || String(body.id || `${targetSlug}-${Date.now().toString(36)}`).trim(),
        contentType,
        section,
        targetSlug,
        title: body.title,
        description: body.description,
        heroImage: body.heroImage,
        meta: body.meta,
        category: body.category,
        authorName: profile.displayName,
        authorEmail: profile.email,
        authorRole: isAdmin ? "admin" : "member",
        readTime: body.readTime,
        markdown: body.markdown,
        githubUrl: body.githubUrl,
        documentTitle: body.documentTitle,
        ctaLabel: body.ctaLabel,
        ctaHref: body.ctaHref,
        requestKind: body.requestKind || (existing ? "edit" : "create"),
        status: isAdmin ? "approved" : "pending",
        createdByUserId: profile.userId,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        reviewedByUserId: isAdmin ? profile.userId : "",
        reviewedAt: isAdmin ? new Date().toISOString() : "",
      });

      return sendJson(res, 200, {
        item,
        requestId,
        message: isAdmin ? "Content published." : "Content request submitted for admin review.",
      });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed.", requestId });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error?.message || "Internal server error.",
      requestId,
    });
  }
};

async function getExisting(id) {
  const { getContentById } = require("./_contentStore");
  return getContentById(id);
}

function normalizeContentType(contentType, section) {
  const direct = String(contentType || "").trim().toLowerCase();
  if (direct === "blog" || direct === "project" || direct === "page") {
    return direct;
  }
  if (section === "projects") {
    return "project";
  }
  if (section === "about" || section === "works") {
    return "page";
  }
  return "blog";
}

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    throw createHttpError(403, "Only admins can manage content.");
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

function getQueryValue(url, name) {
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get(name);
  } catch {
    return "";
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
