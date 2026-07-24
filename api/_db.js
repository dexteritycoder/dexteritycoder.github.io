const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const rawConnectionString = resolveDatabaseConnectionString();
    if (!rawConnectionString) {
      throw createHttpError(
        500,
        "Database is not configured. Add DATABASE_URL/POSTGRES_URL to Vercel and redeploy."
      );
    }

    const sanitizedConnectionString = sanitizeConnectionString(rawConnectionString);
    const ssl = resolveDatabaseSslConfig(rawConnectionString);
    pool = new Pool({
      connectionString: sanitizedConnectionString,
      ssl,
      max: Number(process.env.AUTH_DB_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.AUTH_DB_IDLE_TIMEOUT_MS || 5000),
      connectionTimeoutMillis: Number(process.env.AUTH_DB_CONNECT_TIMEOUT_MS || 10000),
      allowExitOnIdle: true,
      keepAlive: true,
    });
  }

  return pool;
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

  const discoveredUrl = Object.entries(process.env).find(([name, value]) => {
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

  return buildConnectionStringFromParts();
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
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
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

function cleanEnvValue(value) {
  return String(value || "").trim();
}

function createHttpError(statusCode, message, cause) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

module.exports = {
  createHttpError,
  getPool,
  cleanEnvValue,
};
