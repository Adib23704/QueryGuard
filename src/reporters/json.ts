import type { AnalysisResult } from "../analyzer/types.js";

export interface JsonReportExport extends AnalysisResult {
  version: string;
  generatedAt: string;
}

export function renderJsonReport(result: AnalysisResult): string {
  const exportPayload: JsonReportExport = {
    version: "1.0.3",
    generatedAt: new Date().toISOString(),
    ...result,
  };

  return JSON.stringify(exportPayload, null, 2);
}
