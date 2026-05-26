import type { ExtensionInit } from "@fiberplane/extensions";

/**
 * Registers Tarmac orchestration properties on issues.
 *
 * tarmac_state is a human-glance mirror. Eligibility is derived from built-in
 * fp status, tarmac_ready, dependencies, child issues, and the orchestrator's
 * active run index, not from tarmac_state alone.
 */
const init: ExtensionInit = async (fp) => {
  await fp.issues.registerProperty("tarmac_ready", {
    label: "Ready for Tarmac",
    icon: "check-circle",
    display: fp.ui.properties.select(
      fp.ui.properties.option("true", {
        label: "Ready",
        icon: "circle-check",
        color: "success",
      }),
      fp.ui.properties.option("false", {
        label: "Not Ready",
        icon: "circle-x",
        color: "neutral",
      }),
    ),
  });

  await fp.issues.registerProperty("tarmac_state", {
    label: "Tarmac State",
    icon: "activity",
    display: fp.ui.properties.select(
      fp.ui.properties.option("idle", {
        label: "Idle",
        icon: "circle",
        color: "neutral",
      }),
      fp.ui.properties.option("active", {
        label: "Active",
        icon: "loader",
        color: "blue",
      }),
      fp.ui.properties.option("end", {
        label: "End",
        icon: "circle-check",
        color: "success",
      }),
      fp.ui.properties.option("needs-attention", {
        label: "Needs Attention",
        icon: "alert-circle",
        color: "destructive",
      }),
    ),
  });

  await fp.issues.registerProperty("tarmac_attempt", {
    label: "Tarmac Attempt",
    icon: "hash",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_claim_id", {
    label: "Tarmac Claim ID",
    icon: "fingerprint",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_agent_id", {
    label: "Cursor Agent ID",
    icon: "bot",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_run_id", {
    label: "Cursor Run ID",
    icon: "activity",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_branch", {
    label: "Tarmac Branch",
    icon: "git-branch",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_pr_url", {
    label: "Tarmac PR URL",
    icon: "git-pull-request",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_pr_number", {
    label: "Tarmac PR Number",
    icon: "hash",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_base_sha", {
    label: "Tarmac Base SHA",
    icon: "git-commit",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_head_sha", {
    label: "Tarmac Head SHA",
    icon: "git-commit",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty("tarmac_last_error", {
    label: "Tarmac Last Error",
    icon: "alert-triangle",
    display: fp.ui.properties.text(),
  });

  fp.on("issue:status:changed", ({ issue, from, to }) => {
    fp.log.info(`[tarmac-dispatch] ${issue.id} status: ${from} -> ${to}`);
  });
};

export default init;
