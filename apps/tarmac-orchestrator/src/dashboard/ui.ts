export const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tarmac Dashboard</title>
    <link rel="stylesheet" href="/dashboard.css" />
  </head>
  <body>
    <header class="app-header" aria-label="Dashboard header">
      <div class="app-header__brand">
        <h1 class="wordmark">Tarmac</h1>
        <p class="app-header__subtitle">Local operator console</p>
      </div>
      <div class="app-header__meta">
        <div id="repo-meta" class="meta-line"></div>
        <div id="scan-source" class="meta-line"></div>
      </div>
      <div class="app-header__modes" aria-label="Dashboard mode">
        <span class="mode-badge">Local only</span>
        <span class="mode-badge">Read only</span>
      </div>
      <div class="app-header__actions">
        <span id="generated-at" class="meta-line"></span>
        <button id="refresh" type="button" title="Refresh dashboard data">Refresh</button>
      </div>
    </header>

    <div id="error-banner" class="error-banner" role="alert" hidden></div>

    <main class="console-layout">
      <section class="panel queue-panel" aria-labelledby="queue-heading">
        <h2 id="queue-heading">Issue queue</h2>
        <div id="queue-panel" class="panel-body"></div>
      </section>

      <div class="center-column">
        <section class="panel detail-panel" aria-labelledby="detail-heading">
          <h2 id="detail-heading">Issue detail</h2>
          <div id="detail-panel" class="panel-body"></div>
        </section>
        <section class="panel bout-panel" aria-labelledby="bout-heading">
          <h2 id="bout-heading">Bout rollup</h2>
          <div id="bouts-panel" class="panel-body"></div>
        </section>
      </div>

      <div class="right-column">
        <section class="panel ledger-panel" aria-labelledby="ledger-heading">
          <h2 id="ledger-heading">Run ledger</h2>
          <div id="runs-panel" class="panel-body"></div>
        </section>
        <section class="panel timeline-panel" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Dispatch timeline</h2>
          <div id="timeline-panel" class="panel-body"></div>
        </section>
      </div>
    </main>

    <section class="panel logs-panel" aria-labelledby="logs-heading">
      <div class="logs-panel__head">
        <h2 id="logs-heading">Logs</h2>
        <span id="logs-context" class="meta-line"></span>
      </div>
      <div id="logs-panel" class="panel-body logs-table-wrap"></div>
    </section>

    <script src="/dashboard.js"></script>
  </body>
</html>
`;
