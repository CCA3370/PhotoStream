import { spawn } from "node:child_process";

const stderrLimit = 16 * 1_024;
const binaryVariables = {
  pg_dump: "PG_DUMP_BIN",
  pg_restore: "PG_RESTORE_BIN",
  psql: "PSQL_BIN",
};

export function parseDatabaseUrl(value, variableName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${variableName} is required`);
  }
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${variableName} must use postgresql://`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (database.length === 0) throw new Error(`${variableName} must include a database name`);
  if (url.username.length === 0) throw new Error(`${variableName} must include a database user`);
  return {
    database,
    host: url.hostname,
    password: decodeURIComponent(url.password),
    port: url.port || "5432",
    sslMode: url.searchParams.get("sslmode"),
    user: decodeURIComponent(url.username),
  };
}

function commandFor(tool, connection, args, environment, connect) {
  const container = environment.POSTGRES_CONTAINER;
  if (container !== undefined && container.length > 0) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(container)) {
      throw new Error("POSTGRES_CONTAINER is invalid");
    }
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        container,
        tool,
        ...(connect ? ["-U", connection.user, "-d", connection.database] : []),
        ...args,
      ],
      environment,
    };
  }
  const binaryVariable = binaryVariables[tool];
  if (binaryVariable === undefined) throw new Error(`Unsupported PostgreSQL tool: ${tool}`);
  return {
    command: environment[binaryVariable] || tool,
    args: [...(connect ? ["-U", connection.user, "-d", connection.database] : []), ...args],
    environment: {
      ...process.env,
      PGHOST: connection.host,
      PGPORT: connection.port,
      PGPASSWORD: connection.password,
      ...(connection.sslMode === null ? {} : { PGSSLMODE: connection.sslMode }),
    },
  };
}

export function spawnPostgresTool(
  tool,
  connection,
  args,
  environment = process.env,
  { connect = true } = {},
) {
  const command = commandFor(tool, connection, args, environment, connect);
  return spawn(command.command, command.args, {
    env: command.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function processResult(child, label) {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < stderrLimit) stderr += chunk.slice(0, stderrLimit - stderr.length);
  });
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${label} could not start`, { cause: error })));
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed (${signal === null ? `exit ${String(code)}` : `signal ${signal}`}): ${stderr.trim() || "no diagnostic"}`,
        ),
      );
    });
  });
}

export async function queryScalar(connection, query, environment = process.env) {
  const child = spawnPostgresTool(
    "psql",
    connection,
    ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query],
    environment,
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length < stderrLimit) stdout += chunk.slice(0, stderrLimit - stdout.length);
  });
  await processResult(child, "psql");
  return stdout.trim();
}
