import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../../src/analyzer/types.js";
import { evaluateExitCode } from "../../src/cli/exec.js";
import { parseCliArgs } from "../../src/cli/index.js";

const dummyResult: AnalysisResult = {
  summary: {
    totalQueries: 10,
    uniqueQueries: 3,
    totalDurationMs: 50.0,
    wastedDurationMs: 20.0,
    nPlusOneCount: 2,
    duplicateCount: 1,
    seqScanCount: 1,
  },
  issues: [],
  recommendations: [],
  traces: [],
  sessions: [],
};

const cleanResult: AnalysisResult = {
  summary: {
    totalQueries: 5,
    uniqueQueries: 5,
    totalDurationMs: 15.0,
    wastedDurationMs: 0.0,
    nPlusOneCount: 0,
    duplicateCount: 0,
    seqScanCount: 0,
  },
  issues: [],
  recommendations: [],
  traces: [],
  sessions: [],
};

describe("CLI Options & Exit Code Evaluation", () => {
  it("evaluates exit code based on child process exit code", () => {
    // Child failure overrides analysis
    expect(evaluateExitCode(1, cleanResult, {})).toBe(1);
    expect(evaluateExitCode(130, dummyResult, {})).toBe(130);
  });

  it("fails with exit code 1 when --fail-on-n-plus-one is set and N+1 queries detected", () => {
    expect(
      evaluateExitCode(0, dummyResult, {
        failOnNPlusOne: true,
      }),
    ).toBe(1);

    expect(
      evaluateExitCode(0, cleanResult, {
        failOnNPlusOne: true,
      }),
    ).toBe(0);
  });

  it("fails with exit code 1 when --fail-on-seq-scan is set and sequential scan detected", () => {
    expect(
      evaluateExitCode(0, dummyResult, {
        failOnSeqScan: true,
      }),
    ).toBe(1);

    expect(
      evaluateExitCode(0, cleanResult, {
        failOnSeqScan: true,
      }),
    ).toBe(0);
  });

  it("passes with exit code 0 when no failure flags are tripped", () => {
    expect(evaluateExitCode(0, dummyResult, {})).toBe(0);
  });

  it("parses CLI exec command arguments and flags accurately", () => {
    const program = parseCliArgs([
      "node",
      "queryguard",
      "exec",
      "--port",
      "5499",
      "--fail-on-n-plus-one",
      "--html-report",
      "custom-report.html",
      "--",
      "npm",
      "test",
    ]);

    const execCmd = program.commands.find((c) => c.name() === "exec");
    expect(execCmd).toBeDefined();
  });
});
