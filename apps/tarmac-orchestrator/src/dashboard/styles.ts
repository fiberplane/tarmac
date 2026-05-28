export const dashboardCss = `
:root {
  color-scheme: light;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  --bg: #f7f4ef;
  --surface: #fffdf9;
  --text: #2b2b2b;
  --muted: #5f5f5f;
  --border: #cfc7bb;
  --teal: #3d7a76;
  --steel: #4a6fa5;
  --coral: #c45c4a;
  --warn-bg: #f5e6a8;
  --warn-text: #6b4e00;
  --ok: #2f6f4e;
  --radius: 4px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: var(--space-2);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

h1, h2, p { margin: 0; }

.app-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto auto;
  gap: var(--space-2);
  align-items: start;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-2);
}

.wordmark {
  font-size: 1.1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-header__subtitle {
  color: var(--muted);
  font-size: 0.72rem;
  margin-top: var(--space-1);
}

.meta-line {
  color: var(--muted);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.app-header__modes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.mode-badge {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px var(--space-1);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--surface);
}

.app-header__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-1);
}

button {
  font: inherit;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

button:hover { border-color: var(--teal); }
button:focus-visible {
  outline: 2px solid var(--steel);
  outline-offset: 1px;
}

.console-layout {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1.4fr) minmax(0, 1.2fr);
  gap: var(--space-2);
  min-height: 0;
}

.center-column,
.right-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  min-width: 0;
}

.panel h2 {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: var(--space-2);
  border-bottom: 1px solid var(--border);
  color: var(--muted);
}

.panel-body {
  padding: var(--space-2);
  min-width: 0;
}

.queue-panel .panel-body,
.ledger-panel .panel-body {
  max-height: 22rem;
  overflow: auto;
}

.detail-panel .panel-body,
.bout-panel .panel-body,
.timeline-panel .panel-body {
  max-height: 14rem;
  overflow: auto;
}

.logs-panel {
  margin-top: var(--space-2);
}

.logs-panel__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
  justify-content: space-between;
  padding: var(--space-2);
  border-bottom: 1px solid var(--border);
}

.logs-table-wrap {
  max-height: 12rem;
  overflow: auto;
}

.group-block + .group-block {
  margin-top: var(--space-2);
}

.group-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: var(--space-1);
}

.select-row {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  padding: var(--space-1) var(--space-2);
  margin-bottom: 2px;
}

.select-row:hover { border-color: var(--border); background: var(--bg); }
.select-row[aria-selected="true"] {
  border-color: var(--teal);
  background: color-mix(in srgb, var(--teal) 8%, var(--surface));
}

.select-row:focus-visible {
  outline: 2px solid var(--steel);
  outline-offset: 0;
}

.row-title { font-weight: 600; }
.row-sub { color: var(--muted); font-size: 0.68rem; margin-top: 2px; }

.tag {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 var(--space-1);
  font-size: 0.65rem;
  margin-right: var(--space-1);
}

.tag::before {
  content: "● ";
  font-size: 0.55rem;
}

.tag.ok { color: var(--ok); border-color: var(--ok); }
.tag.warn { color: var(--warn-text); background: var(--warn-bg); border-color: #d9c56a; }
.tag.bad { color: var(--coral); border-color: var(--coral); }
.tag.run { color: var(--steel); border-color: var(--steel); }
.tag.neutral { color: var(--muted); }

.detail-grid {
  display: grid;
  grid-template-columns: minmax(6rem, 8rem) minmax(0, 1fr);
  gap: var(--space-1) var(--space-2);
}

.detail-grid dt {
  color: var(--muted);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.bout-card + .bout-card {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}

.bout-parent { font-weight: 600; margin-bottom: var(--space-1); }

.bout-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bout-children li {
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border);
}

.bout-children li:last-child { border-bottom: 0; }

.timeline-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.timeline-list li {
  display: grid;
  grid-template-columns: minmax(0, 6.5rem) minmax(0, 1fr);
  gap: var(--space-1);
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border);
}

.timeline-list li:last-child { border-bottom: 0; }

.timeline-time { color: var(--muted); font-size: 0.68rem; }

table.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.68rem;
}

table.log-table th,
table.log-table td {
  text-align: left;
  vertical-align: top;
  padding: var(--space-1);
  border-bottom: 1px solid var(--border);
  word-break: break-word;
}

table.log-table th {
  color: var(--muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--surface);
}

.log-sev-info { color: var(--muted); }
.log-sev-warn { color: var(--warn-text); }
.log-sev-error { color: var(--coral); font-weight: 600; }

.empty {
  color: var(--muted);
  font-style: italic;
}

.error-banner {
  border: 1px solid var(--coral);
  color: var(--coral);
  background: color-mix(in srgb, var(--coral) 8%, var(--surface));
  padding: var(--space-2);
  margin-bottom: var(--space-2);
  border-radius: var(--radius);
}

a { color: var(--steel); }
a:focus-visible { outline: 2px solid var(--steel); outline-offset: 1px; }

.scan-badge {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px var(--space-1);
  font-size: 0.65rem;
  text-transform: uppercase;
}

.scan-badge.live { color: var(--teal); border-color: var(--teal); }
.scan-badge.cached { color: var(--warn-text); background: var(--warn-bg); border-color: #d9c56a; }
.scan-badge.unavailable { color: var(--coral); border-color: var(--coral); }

@media (max-width: 56rem) {
  .app-header {
    grid-template-columns: 1fr 1fr;
  }

  .console-layout {
    grid-template-columns: 1fr;
  }

  .queue-panel .panel-body,
  .ledger-panel .panel-body,
  .detail-panel .panel-body,
  .bout-panel .panel-body,
  .timeline-panel .panel-body {
    max-height: none;
  }
}

@media (max-width: 30rem) {
  body { padding: var(--space-1); }

  .app-header {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .detail-grid dt { margin-top: var(--space-1); }

  table.log-table thead { display: none; }

  table.log-table tr {
    display: block;
    margin-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }

  table.log-table td {
    display: block;
    border-bottom: 0;
    padding: 2px var(--space-1);
  }

  table.log-table td::before {
    content: attr(data-label) ": ";
    color: var(--muted);
    text-transform: uppercase;
    font-size: 0.62rem;
  }
}
`;
