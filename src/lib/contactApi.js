export async function submitContactRequest(payload) {
  const response = await fetch("/api/contact", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await readJsonResponse(response);
  if (!response.ok) {
    throw createApiError(result?.error || "Could not send your message.", result?.requestId || "");
  }

  return result || null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createApiError(message, requestId = "") {
  const error = new Error(message);
  error.requestId = requestId;
  return error;
}
