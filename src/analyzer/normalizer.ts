import { createHash } from "node:crypto";
import type { NormalizedQuery, SqlCommand } from "./types.js";

export function normalizeSql(rawSql: string): NormalizedQuery {
  if (!rawSql || typeof rawSql !== "string") {
    return {
      originalSql: "",
      fingerprintSql: "",
      hash: createHash("sha256").update("").digest("hex"),
      command: "OTHER",
    };
  }

  let sql = rawSql.replace(/--.*$/gm, " ");
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, " ");

  sql = sql.replace(/E?'(?:''|[^'])*'/gi, " __PARAM__ ");

  sql = sql.replace(/\$\d+/g, " __PARAM__ ");
  sql = sql.replace(/\?/g, " __PARAM__ ");

  sql = sql.replace(/\b(true|false)\b/gi, " __PARAM__ ");

  sql = sql.replace(/(?<=[<>=!+\-*/(,\s]|^)-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, " __PARAM__ ");

  sql = sql.replace(/\bIN\s*\(\s*(?:__PARAM__\s*,\s*)*__PARAM__\s*\)/gi, "IN (...)");
  sql = sql.replace(/\bIN\s*\(\s*\.\.\.\s*\)/gi, "IN (...)");

  sql = sql.replace(/__PARAM__/g, "$?");

  sql = sql.replace(/\s+/g, " ").trim().toUpperCase();

  sql = sql.replace(/\s*([<>!=]=?)\s*/g, " $1 ");
  sql = sql.replace(/\s*,\s*/g, ", ");
  sql = sql.replace(/\s*\(\s*/g, " (");
  sql = sql.replace(/\s*\)\s*/g, ") ");
  sql = sql.replace(/\s+/g, " ").trim();
  sql = sql.replace(/\(\s*\.\.\.\s*\)/g, "(...)");

  let command: SqlCommand = "OTHER";
  const firstWord = sql.split(" ")[0] ?? "";
  if (firstWord === "SELECT") command = "SELECT";
  else if (firstWord === "INSERT") command = "INSERT";
  else if (firstWord === "UPDATE") command = "UPDATE";
  else if (firstWord === "DELETE") command = "DELETE";

  const table = extractTableName(rawSql, command);

  const hash = createHash("sha256").update(sql).digest("hex");

  return {
    originalSql: rawSql,
    fingerprintSql: sql,
    hash,
    command,
    table,
  };
}

function extractTableName(rawSql: string, command: SqlCommand): string | undefined {
  let match: RegExpMatchArray | null = null;

  if (command === "SELECT" || command === "DELETE") {
    match = rawSql.match(/\bFROM\s+([a-zA-Z0-9_".]+)/i);
  } else if (command === "INSERT") {
    match = rawSql.match(/\bINTO\s+([a-zA-Z0-9_".]+)/i);
  } else if (command === "UPDATE") {
    match = rawSql.match(/\bUPDATE\s+([a-zA-Z0-9_".]+)/i);
  }

  if (!match?.[1]) return undefined;

  const rawTable = match[1];
  const parts = rawTable.split(".");
  const tableWithQuotes = parts[parts.length - 1] ?? rawTable;
  return tableWithQuotes.replace(/["`]/g, "").trim().toLowerCase();
}
