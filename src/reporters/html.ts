import type { AnalysisResult } from "../analyzer/types.js";

export function renderHtmlReport(result: AnalysisResult): string {
  const { summary, issues, recommendations, traces } = result;

  let minStartTime = traces.length > 0 ? (traces[0]?.startTime ?? 0) : 0;
  let maxEndTime = traces.length > 0 ? (traces[0]?.endTime ?? 0) : 0;

  for (const t of traces) {
    if (t.startTime < minStartTime) minStartTime = t.startTime;
    if (t.endTime > maxEndTime) maxEndTime = t.endTime;
  }

  const totalTimeSpan = Math.max(1, maxEndTime - minStartTime);

  const nPlusOneTraceIds = new Set<string>();
  const duplicateTraceIds = new Set<string>();

  for (const issue of issues) {
    if (issue.type === "N_PLUS_ONE") {
      for (const id of issue.traceIds) {
        nPlusOneTraceIds.add(id);
      }
    } else if (issue.type === "DUPLICATE_QUERY") {
      for (const id of issue.traceIds) {
        duplicateTraceIds.add(id);
      }
    }
  }

  const serializedData = JSON.stringify({
    summary,
    issues,
    recommendations,
    traces,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QueryGuard Performance Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --cyan: #38bdf8;
      --green: #4ade80;
      --yellow: #fbbf24;
      --red: #f87171;
      --purple: #c084fc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand h1 { font-size: 24px; color: var(--heading); font-weight: 700; }
    .badge {
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-pass { background: rgba(74, 222, 128, 0.15); color: var(--green); border: 1px solid rgba(74, 222, 128, 0.3); }
    .badge-warn { background: rgba(251, 191, 36, 0.15); color: var(--yellow); border: 1px solid rgba(251, 191, 36, 0.3); }
    .badge-fail { background: rgba(248, 113, 113, 0.15); color: var(--red); border: 1px solid rgba(248, 113, 113, 0.3); }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-title { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .stat-value { font-size: 24px; font-weight: 700; color: var(--heading); }
    .stat-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 28px;
    }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--heading);
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .waterfall-container {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      max-height: 400px;
      overflow-y: auto;
    }
    .timeline-row {
      display: flex;
      align-items: center;
      height: 28px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      cursor: pointer;
    }
    .timeline-row:hover { background: rgba(255,255,255,0.03); }
    .timeline-label {
      width: 220px;
      font-family: monospace;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-muted);
      padding-right: 12px;
    }
    .timeline-track {
      flex: 1;
      height: 14px;
      background: rgba(255,255,255,0.02);
      border-radius: 3px;
      position: relative;
    }
    .timeline-bar {
      position: absolute;
      height: 100%;
      border-radius: 2px;
      min-width: 3px;
    }
    .bar-normal { background: var(--cyan); }
    .bar-nplusone { background: var(--red); }
    .bar-dup { background: var(--yellow); }
    
    .table-controls {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    .search-input, .filter-select {
      background: #090d13;
      border: 1px solid var(--border);
      color: var(--heading);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }
    .search-input { flex: 1; }
    .search-input:focus, .filter-select:focus { border-color: var(--cyan); }
    
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; }
    td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); font-family: monospace; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .sql-cell {
      max-width: 500px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text);
    }
    
    pre {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      color: var(--cyan);
      font-family: monospace;
      font-size: 13px;
      overflow-x: auto;
      margin-bottom: 12px;
    }
    .copy-btn {
      background: #21262d;
      border: 1px solid var(--border);
      color: var(--heading);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      float: right;
    }
    .copy-btn:hover { background: #30363d; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>🛡️ QueryGuard</h1>
        <span class="badge ${
          summary.nPlusOneCount === 0 && summary.seqScanCount === 0 ? "badge-pass" : "badge-warn"
        }">
          ${summary.nPlusOneCount === 0 && summary.seqScanCount === 0 ? "Passed" : "Action Needed"}
        </span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);">
        Report Generated: ${new Date().toLocaleTimeString()}
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">Total Queries</div>
        <div class="stat-value">${summary.totalQueries}</div>
        <div class="stat-sub">${summary.uniqueQueries} Unique Signatures</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Total Execution Time</div>
        <div class="stat-value">${summary.totalDurationMs.toFixed(1)} <span style="font-size:14px; font-weight:normal;">ms</span></div>
        <div class="stat-sub">Across all connections</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Wasted Latency</div>
        <div class="stat-value" style="color: ${summary.wastedDurationMs > 0 ? "var(--yellow)" : "var(--green)"};">
          ${summary.wastedDurationMs.toFixed(1)} <span style="font-size:14px; font-weight:normal;">ms</span>
        </div>
        <div class="stat-sub">Redundant & N+1 queries</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">N+1 Cascades</div>
        <div class="stat-value" style="color: ${summary.nPlusOneCount > 0 ? "var(--red)" : "var(--green)"};">
          ${summary.nPlusOneCount}
        </div>
        <div class="stat-sub">Repetitive query patterns</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Unindexed Scans</div>
        <div class="stat-value" style="color: ${summary.seqScanCount > 0 ? "var(--red)" : "var(--green)"};">
          ${summary.seqScanCount}
        </div>
        <div class="stat-sub">High-cost sequential scans</div>
      </div>
    </div>

    ${
      recommendations.length > 0
        ? `
    <div class="card">
      <div class="card-title">
        <span>Automated Index Recommendations (${recommendations.length})</span>
      </div>
      ${recommendations
        .map(
          (rec) => `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">
            Target Table: <b style="color:var(--heading);">${rec.tableName}</b> - ${rec.reason}
          </div>
          <pre><code>${rec.ddl}</code><button class="copy-btn" onclick="copyToClipboard('${rec.ddl.replace(/'/g, "\\'")}', this)">Copy DDL</button></pre>
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : ""
    }

    <div class="card">
      <div class="card-title">
        <span>Execution Waterfall Timeline</span>
        <div style="display:flex; gap:16px; font-size:12px; font-weight:normal;">
          <span style="color:var(--cyan);">■ Normal</span>
          <span style="color:var(--yellow);">■ Duplicate</span>
          <span style="color:var(--red);">■ N+1 Cascade</span>
        </div>
      </div>
      <div class="waterfall-container">
        ${traces
          .map((t, idx) => {
            const leftPercent = Math.max(0, ((t.startTime - minStartTime) / totalTimeSpan) * 100);
            const widthPercent = Math.max(0.5, (t.durationMs / totalTimeSpan) * 100);
            let barClass = "bar-normal";
            if (nPlusOneTraceIds.has(t.id)) barClass = "bar-nplusone";
            else if (duplicateTraceIds.has(t.id)) barClass = "bar-dup";

            return `
          <div class="timeline-row" title="${t.sql.replace(/"/g, "&quot;")} (${t.durationMs}ms)">
            <div class="timeline-label">#${idx + 1} (${t.durationMs}ms) ${t.sql}</div>
            <div class="timeline-track">
              <div class="timeline-bar ${barClass}" style="left: ${leftPercent.toFixed(2)}%; width: ${widthPercent.toFixed(2)}%;"></div>
            </div>
          </div>
        `;
          })
          .join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Query Traces Table (${traces.length})</span>
      </div>
      <div class="table-controls">
        <input type="text" id="searchInput" class="search-input" placeholder="Search SQL, table, or parameters..." oninput="filterTable()">
        <select id="filterSelect" class="filter-select" onchange="filterTable()">
          <option value="ALL">All Queries</option>
          <option value="NPLUSONE">N+1 Queries Only</option>
          <option value="DUPLICATE">Duplicates Only</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 50px;">#</th>
            <th style="width: 80px;">Conn</th>
            <th style="width: 100px;">Duration</th>
            <th style="width: 110px;">Type</th>
            <th>SQL Query</th>
          </tr>
        </thead>
        <tbody id="queryTableBody">
          ${traces
            .map((t, idx) => {
              let badge = '<span class="badge badge-pass">OK</span>';
              let rowType = "NORMAL";
              if (nPlusOneTraceIds.has(t.id)) {
                badge = '<span class="badge badge-fail">N+1</span>';
                rowType = "NPLUSONE";
              } else if (duplicateTraceIds.has(t.id)) {
                badge = '<span class="badge badge-warn">DUP</span>';
                rowType = "DUPLICATE";
              }

              return `
            <tr data-type="${rowType}" data-sql="${t.sql.replace(/"/g, "&quot;")}">
              <td>${idx + 1}</td>
              <td>#${t.connectionId}</td>
              <td style="color:${t.durationMs > 20 ? "var(--yellow)" : "var(--green)"};">${t.durationMs.toFixed(1)} ms</td>
              <td>${badge}</td>
              <td class="sql-cell" title="${t.sql.replace(/"/g, "&quot;")}">${t.sql}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const data = ${serializedData};

    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        btn.style.color = "var(--green)";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.color = "inherit";
        }, 1500);
      });
    }

    function filterTable() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const typeFilter = document.getElementById('filterSelect').value;
      const rows = document.querySelectorAll('#queryTableBody tr');

      rows.forEach(row => {
        const sql = row.getAttribute('data-sql').toLowerCase();
        const type = row.getAttribute('data-type');

        const matchesSearch = !search || sql.includes(search);
        const matchesType = typeFilter === 'ALL' || type === typeFilter;

        row.style.display = (matchesSearch && matchesType) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}
