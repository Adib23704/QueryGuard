import { describe, expect, it } from "vitest";
import { normalizeSql } from "../../src/analyzer/normalizer.js";

describe("SQL Normalizer & Deterministic Fingerprinting", () => {
  it("normalizes single and double quoted string literals to $?", () => {
    const rawSql =
      "SELECT id, name FROM users WHERE email = 'john.doe@example.com' AND status = 'ACTIVE'";
    const normalized = normalizeSql(rawSql);

    expect(normalized.fingerprintSql).toBe(
      "SELECT ID, NAME FROM USERS WHERE EMAIL = $? AND STATUS = $?",
    );
  });

  it("normalizes integers, decimals, and negative numbers to $?", () => {
    const rawSql = "SELECT * FROM products WHERE price > 49.99 AND stock <= 0 AND discount >= -10";
    const normalized = normalizeSql(rawSql);

    expect(normalized.fingerprintSql).toBe(
      "SELECT * FROM PRODUCTS WHERE PRICE > $? AND STOCK <= $? AND DISCOUNT >= $?",
    );
  });

  it("normalizes positional parameters ($1, $2, ...) and question mark placeholders to canonical $?", () => {
    const rawSql = "SELECT id FROM orders WHERE user_id = $1 AND store_id = $2 AND status = ?";
    const normalized = normalizeSql(rawSql);

    expect(normalized.fingerprintSql).toBe(
      "SELECT ID FROM ORDERS WHERE USER_ID = $? AND STORE_ID = $? AND STATUS = $?",
    );
  });

  it("folds variable-length IN lists into canonical IN (...)", () => {
    const queryA = "SELECT * FROM users WHERE id IN (1, 2, 3, 4, 5)";
    const queryB = "SELECT * FROM users WHERE id IN (99, 102)";

    const normA = normalizeSql(queryA);
    const normB = normalizeSql(queryB);

    expect(normA.fingerprintSql).toBe("SELECT * FROM USERS WHERE ID IN (...)");
    expect(normB.fingerprintSql).toBe("SELECT * FROM USERS WHERE ID IN (...)");
    expect(normA.hash).toBe(normB.hash);
  });

  it("collapses multiline formatting, comments, and irregular whitespace", () => {
    const rawSql = `
      -- Fetch active users
      SELECT  id,   name,
              created_at
      FROM    users
      /* multi-line
         comment */
      WHERE   active = true
      ORDER BY   created_at DESC
    `;
    const normalized = normalizeSql(rawSql);

    expect(normalized.fingerprintSql).toBe(
      "SELECT ID, NAME, CREATED_AT FROM USERS WHERE ACTIVE = $? ORDER BY CREATED_AT DESC",
    );
  });

  it("generates deterministic SHA-256 fingerprint hash for semantically identical queries", () => {
    const q1 = "SELECT * FROM orders WHERE customer_id = 42 AND total > 100.00";
    const q2 = "SELECT  *  FROM  orders  WHERE  customer_id = 999  AND  total > 5.50";

    const res1 = normalizeSql(q1);
    const res2 = normalizeSql(q2);

    expect(res1.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(res1.hash).toBe(res2.hash);
  });

  it("extracts primary table name and query command type", () => {
    const selectRes = normalizeSql("SELECT u.id FROM users u WHERE u.id = 1");
    expect(selectRes.command).toBe("SELECT");
    expect(selectRes.table).toBe("users");

    const insertRes = normalizeSql(
      "INSERT INTO audit_logs (event, timestamp) VALUES ('login', '2026-01-01')",
    );
    expect(insertRes.command).toBe("INSERT");
    expect(insertRes.table).toBe("audit_logs");

    const updateRes = normalizeSql("UPDATE accounts SET balance = balance - 50 WHERE id = 10");
    expect(updateRes.command).toBe("UPDATE");
    expect(updateRes.table).toBe("accounts");

    const deleteRes = normalizeSql("DELETE FROM sessions WHERE expired_at < NOW()");
    expect(deleteRes.command).toBe("DELETE");
    expect(deleteRes.table).toBe("sessions");
  });
});
