const { createHttpError, getPool } = require("./_db");

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensureContactSchema();

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed.", requestId });
    }

    const body = normalizeBody(req.body);
    const payload = normalizeContactPayload(body);
    const record = await saveContactSubmission(payload);

    return sendJson(res, 200, {
      message: "Your message has been saved. I will review it soon.",
      submissionId: record.id,
      requestId,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error?.message || "Internal server error.",
      requestId,
    });
  }
};

async function ensureContactSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      contact_mode TEXT NOT NULL DEFAULT 'normal',
      contact_number TEXT NOT NULL DEFAULT '',
      inquiry_type TEXT NOT NULL DEFAULT '',
      selected_gig TEXT NOT NULL DEFAULT '',
      looking_for TEXT NOT NULL DEFAULT '',
      payment_timing TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS contact_mode TEXT NOT NULL DEFAULT 'normal'`);
  await db.query(`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS contact_number TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS looking_for TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS payment_timing TEXT NOT NULL DEFAULT ''`);
  await db.query(`CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx ON contact_submissions (created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS contact_submissions_inquiry_type_idx ON contact_submissions (inquiry_type)`);
}

async function saveContactSubmission(payload) {
  const db = getPool();
  const id = `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await db.query(
    `
      INSERT INTO contact_submissions (
        id,
        name,
        email,
        contact_mode,
        contact_number,
        inquiry_type,
        selected_gig,
        looking_for,
        payment_timing,
        message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `,
    [
      id,
      payload.name,
      payload.email,
      payload.contactMode,
      payload.contactNumber,
      payload.inquiryType,
      payload.selectedGig,
      payload.lookingFor,
      payload.paymentTiming,
      payload.message,
    ]
  );

  return result.rows[0] || { id };
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

function normalizeContactPayload(body) {
  const contactMode = cleanRequired(body.contactMode, "Please select the contact mode.").toLowerCase();
  if (!new Set(["normal", "enquiry"]).has(contactMode)) {
    throw createHttpError(400, "The selected contact mode is not supported.");
  }
  const inquiryType = contactMode === "enquiry"
    ? cleanRequired(body.inquiryType, "Please select the enquiry type.").toLowerCase()
    : "";
  if (contactMode === "enquiry" && !new Set(["gig", "customized"]).has(inquiryType)) {
    throw createHttpError(400, "The selected enquiry type is not supported.");
  }
  const paymentTiming = contactMode === "enquiry"
    ? cleanRequired(body.paymentTiming, "Please select pay now or pay later.").toLowerCase()
    : "";
  if (paymentTiming && !new Set(["pay-now", "pay-later"]).has(paymentTiming)) {
    throw createHttpError(400, "The selected payment timing is not supported.");
  }

  return {
    name: cleanRequired(body.name, "Name is required.").slice(0, 120),
    email: cleanEmail(body.email),
    contactMode,
    contactNumber: cleanOptional(body.contactNumber, 60),
    inquiryType,
    selectedGig: contactMode === "enquiry" && inquiryType === "gig"
      ? cleanRequired(body.selectedGig, "Please choose a gig.").slice(0, 200)
      : "",
    lookingFor: contactMode === "enquiry"
      ? cleanRequired(body.lookingFor, "Please tell me what you are looking for.").slice(0, 500)
      : "",
    paymentTiming,
    message: cleanRequired(body.message, "Message is required.").slice(0, 5000),
  };
}

function cleanRequired(value, message) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw createHttpError(400, message);
  }
  return normalized;
}

function cleanOptional(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanRequired(value, "Email is required.").slice(0, 160);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw createHttpError(400, "Please enter a valid email address.");
  }
  return email;
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
