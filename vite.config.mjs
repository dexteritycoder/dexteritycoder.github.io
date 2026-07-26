import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const engagementHandler = require("./api/engagement.js");
const accountHandler = require("./api/account.js");
const authConfigHandler = require("./api/auth-config.js");

function engagementApiPlugin() {
  const routes = new Map([
    ["/api/engagement", engagementHandler],
    ["/api/account", accountHandler],
    ["/api/auth-config", authConfigHandler],
  ]);

  async function runHandler(req, res, handler) {
    try {
      req.body = await readRequestBody(req);
      await handler(req, res);
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
      const handler = routes.get(pathname);
      if (!handler) {
        next();
        return;
      }

      await runHandler(req, res, handler);
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
