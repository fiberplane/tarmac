export const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tarmac Dashboard</title>
    <link rel="stylesheet" href="/dashboard.css" />
  </head>
  <body>
    <header>
      <div>
        <h1>Tarmac orchestration dashboard</h1>
        <div id="repo-meta" class="meta"></div>
        <div id="scan-source" class="meta"></div>
      </div>
      <div>
        <span id="generated-at" class="meta"></span>
        <button id="refresh" type="button">Refresh</button>
      </div>
    </header>
    <div id="error-banner" class="error-banner" hidden></div>
    <div class="grid">
      <section class="panel">
        <h2>Scan</h2>
        <div id="scan-panel"></div>
      </section>
      <section class="panel">
        <h2>Bouts</h2>
        <div id="bouts-panel"></div>
      </section>
    </div>
    <section class="panel" style="margin-top: 0.75rem">
      <h2>Runs</h2>
      <div id="runs-panel"></div>
    </section>
    <script src="/dashboard.js"></script>
  </body>
</html>
`;
