import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const engagementHandler = require("./api/engagement.js");

function engagementApiPlugin() {
  const route = "/api/engagement";

  async function runHandler(req, res) {
    try {
      req.body = await readRequestBody(req);
      await engagementHandler(req, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message || "Internal server error." }));
    }
  }

  function attachMiddleware(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url) {
        next();
        return;
      }

      const pathname = req.url.split("?")[0];
      if (pathname !== route) {
        next();
        return;
      }

      await runHandler(req, res);
    });
  }

  return {
    name: "engagement-api-plugin",
    configureServer(server) {
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server);
    },
  };
}

async function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default defineConfig({
  plugins: [react(), engagementApiPlugin()],
});
