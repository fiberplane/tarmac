#!/usr/bin/env bun
/**
 * Fetch and categorize PR review feedback.
 *
 * Usage:
 *   bun run fetch-pr-feedback.ts [--pr PR_NUMBER]
 *
 * If --pr is not specified, uses the PR for the current branch.
 *
 * Output: JSON to stdout with categorized feedback.
 *
 * Categories:
 * - high: Must address before merge (blocker, changes requested)
 * - medium: Should address (standard feedback)
 * - low: Optional suggestions (nit, style)
 * - bot: Informational automated comments (Codecov, Dependabot, etc.)
 * - resolved: Already resolved or outdated threads
 *
 * Bot classification:
 * - Review bots (Cursor, Bugbot, CodeQL, etc.) provide actionable code
 *   feedback. Their comments are categorized by content into high/medium/low
 *   with a `review_bot: true` flag — they are NOT placed in the `bot` bucket.
 * - Info bots (Codecov, Dependabot, Renovate, etc.) post status reports and
 *   are placed in the `bot` bucket for silent skipping.
 */

import { parseArgs } from "node:util";
import { runGh } from "./lib/gh.ts";

// ---------------------------------------------------------------------------
// Bot patterns
// ---------------------------------------------------------------------------

/** Bots that provide actionable code review feedback. */
const REVIEW_BOT_PATTERNS = [
  /^cursor/i,
  /^bugbot/i,
  /^copilot/i,
  /^codex/i,
  /^claude/i,
  /^codeql/i,
  /^sentry/i,
  /^warden/i,
  /^seer/i,
];

/** Bots that post informational status reports — skipped silently. */
const INFO_BOT_PATTERNS = [
  /^codecov/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^mergify/i,
  /^semantic-release/i,
  /^sonarcloud/i,
  /^snyk/i,
  /bot$/i,
  /\[bot\]$/i,
];

function isReviewBot(username: string): boolean {
  return REVIEW_BOT_PATTERNS.some((p) => p.test(username));
}

function isInfoBot(username: string): boolean {
  return INFO_BOT_PATTERNS.some((p) => p.test(username));
}

function isReviewBotSummaryComment(body: string): boolean {
  return /<!--\s*BUGBOT_REVIEW\s*-->/.test(body) && !/<!--\s*BUGBOT_BUG_ID:/i.test(body);
}

function isNonActionableAck(body: string): boolean {
  const normalized = body
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}\s!?.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalized.length === 0 || normalized.length > 120) return false;

  const ackPatterns = [
    /^(lgtm|looks good|looks good to me|approved|ship it|thanks|thank you|nice|great|awesome|perfect|sounds good)[\s!.]*$/i,
    /^(lgtm|looks good|approved|ship it|thanks|thank you|nice|great|awesome|perfect|sounds good)[\s!.]+(thanks|thank you|nice|great|awesome|perfect)?[\s!.]*$/i,
  ];

  return ackPatterns.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// gh CLI helpers
// ---------------------------------------------------------------------------

interface PrInfo {
  number: number;
  url: string;
  headRefName: string;
  author: { login: string };
  latestReviews: Array<{
    state: string;
    author: { login: string };
    body: string;
  }>;
  comments: Array<{
    author: { login: string };
    body: string;
    url?: string;
  }>;
  reviewDecision: string;
}

function getPrInfo(prNumber?: number): PrInfo | null {
  const args = [
    "pr",
    "view",
    "--json",
    "number,url,headRefName,author,latestReviews,comments,reviewDecision",
  ];
  if (prNumber) args.splice(2, 0, String(prNumber));
  return runGh(args) as PrInfo | null;
}

function parseOwnerRepoFromUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      author: { login: string };
      createdAt: string;
    }>;
  };
}

interface ReviewThreadsPage {
  nodes: ReviewThread[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

type ReviewThreadsResult =
  | { ok: true; threads: ReviewThread[] }
  | { ok: false; threads: ReviewThread[]; error: string };

function getReviewThreads(
  owner: string,
  repo: string,
  prNumber: number,
): ReviewThreadsResult {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 50, after: $cursor) {
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              comments(last: 20) {
                nodes {
                  id
                  body
                  author { login }
                  createdAt
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  const threads: ReviewThread[] = [];
  let cursor: string | null = null;

  while (true) {
    const args = [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `pr=${prNumber}`,
    ];
    if (cursor) {
      args.push("-F", `cursor=${cursor}`);
    }

    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });

    if (result.exitCode !== 0) {
      return {
        ok: false,
        threads,
        error: result.stderr.toString().trim() || "reviewThreads GraphQL query failed",
      };
    }

    try {
      const data = JSON.parse(result.stdout.toString());
      const page = data?.data?.repository?.pullRequest?.reviewThreads as
        | ReviewThreadsPage
        | undefined;
      if (!page) {
        return { ok: false, threads, error: "Missing reviewThreads in GraphQL response" };
      }
      threads.push(...(page.nodes ?? []));
      if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) {
        return { ok: true, threads };
      }
      cursor = page.pageInfo.endCursor;
    } catch {
      return { ok: false, threads, error: "Failed to parse reviewThreads GraphQL response" };
    }
  }
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

function detectPriority(body: string): "high" | "medium" | "low" | null {
  const severityMatch = body.match(/\*?\*?\s*(high|medium|low)\s+severity\s*\*?\*?/i);
  if (severityMatch) {
    return severityMatch[1].toLowerCase() as "high" | "medium" | "low";
  }

  // Explicit markers (LOGAF-style)
  const markerPatterns: Array<[RegExp, "high" | "medium" | "low"]> = [
    [/^\s*(?:h:|h\s*:|high:|\[h\])/i, "high"],
    [/^\s*(?:m:|m\s*:|medium:|\[m\])/i, "medium"],
    [/^\s*(?:l:|l\s*:|low:|\[l\])/i, "low"],
  ];

  for (const [pattern, level] of markerPatterns) {
    if (pattern.test(body)) return level;
  }

  return null;
}

function categorizeComment(
  author: string,
  body: string,
): "high" | "medium" | "low" | "bot" {
  // Info bots get skipped (unless also a review bot)
  if (isInfoBot(author) && !isReviewBot(author)) return "bot";

  // Explicit markers first
  const explicit = detectPriority(body);
  if (explicit) return explicit;

  // High-priority content patterns
  const highPatterns = [
    /must\s+(fix|change|update|address)/i,
    /this\s+(is\s+)?(wrong|incorrect|broken|buggy)/i,
    /security\s+(issue|vulnerability|concern)/i,
    /will\s+(break|cause|fail)/i,
    /critical/i,
    /blocker/i,
  ];
  if (highPatterns.some((p) => p.test(body))) return "high";

  // Low-priority content patterns
  const lowPatterns = [
    /nit[:\s]/i,
    /nitpick/i,
    /suggestion[:\s]/i,
    /consider\s+(using|renaming|extracting|simplifying|splitting)/i,
    /could\s+(also\s+)?(be\s+(simplified|shortened|improved|cleaner)|use\s+)/i,
    /might\s+(want\s+to|be\s+(better|cleaner|nicer))/i,
    /optional[:\s]/i,
    /minor[:\s]/i,
    /style[:\s]/i,
    /prefer\s+/i,
    /what\s+do\s+you\s+think/i,
    /up\s+to\s+you/i,
    /take\s+it\s+or\s+leave/i,
    /fwiw/i,
  ];
  if (lowPatterns.some((p) => p.test(body))) return "low";

  return "medium";
}

// ---------------------------------------------------------------------------
// Feedback item builder
// ---------------------------------------------------------------------------

interface FeedbackItem {
  author: string;
  body: string;
  full_body: string;
  path?: string;
  line?: number;
  url?: string;
  resolved?: boolean;
  outdated?: boolean;
  review_bot?: boolean;
  thread_id?: string;
  type?: string;
}

function extractFeedbackItem(opts: {
  body: string;
  author: string;
  path?: string | null;
  line?: number | null;
  url?: string | null;
  isResolved?: boolean;
  isOutdated?: boolean;
  reviewBot?: boolean;
  threadId?: string | null;
}): FeedbackItem {
  const summary =
    opts.body.length > 200
      ? opts.body.slice(0, 200) + "..."
      : opts.body;

  const item: FeedbackItem = {
    author: opts.author,
    body: summary.replace(/\n/g, " ").trim(),
    full_body: opts.body,
  };

  if (opts.path) item.path = opts.path;
  if (opts.line) item.line = opts.line;
  if (opts.url) item.url = opts.url;
  if (opts.isResolved) item.resolved = true;
  if (opts.isOutdated) item.outdated = true;
  if (opts.reviewBot) item.review_bot = true;
  if (opts.threadId) item.thread_id = opts.threadId;

  return item;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      pr: { type: "string", short: "p" },
    },
    allowPositionals: false,
  });

  const prNumber = values.pr ? Number(values.pr) : undefined;

  const prInfo = getPrInfo(prNumber);
  if (!prInfo) {
    console.log(JSON.stringify({ error: "No PR found for current branch" }));
    process.exit(1);
  }

  const parsed = parseOwnerRepoFromUrl(prInfo.url);
  if (!parsed) {
    console.log(JSON.stringify({ error: "Could not determine repository from PR url" }));
    process.exit(1);
  }
  const { owner, repo } = parsed;

  const prAuthor = prInfo.author?.login ?? "";

  const feedback: Record<string, FeedbackItem[]> = {
    high: [],
    medium: [],
    low: [],
    bot: [],
    resolved: [],
  };

  // Process latest review bodies. `reviews` includes historical states, so use
  // latestReviews and only make CHANGES_REQUESTED blocking when the current
  // review decision still reflects it.
  for (const review of prInfo.latestReviews ?? []) {
    const author = review.author?.login ?? "";
    const body = review.body ?? "";
    if (!body || author === prAuthor) continue;

    const item = extractFeedbackItem({ body, author });
    if (isNonActionableAck(body)) {
      feedback.resolved.push(item);
      continue;
    }
    if (review.state === "CHANGES_REQUESTED" && prInfo.reviewDecision === "CHANGES_REQUESTED") {
      item.type = "changes_requested";
      feedback.high.push(item);
    } else if (isReviewBotSummaryComment(body)) {
      feedback.bot.push(item);
    } else if (review.state === "COMMENTED") {
      if (isReviewBot(author)) {
        const category = categorizeComment(author, body);
        item.review_bot = true;
        feedback[category].push(item);
      } else if (isInfoBot(author)) {
        feedback.bot.push(item);
      } else {
        const category = categorizeComment(author, body);
        item.type = "review_comment";
        feedback[category].push(item);
      }
    }
  }

  // Process top-level PR comments.
  for (const comment of prInfo.comments ?? []) {
    const author = comment.author?.login ?? "";
    const body = comment.body ?? "";
    if (!body || author === prAuthor || body.trim().length < 3) continue;

    const item = extractFeedbackItem({ body, author, url: comment.url });
    item.type = "pr_comment";
    if (isNonActionableAck(body)) {
      feedback.resolved.push(item);
    } else if (isReviewBotSummaryComment(body)) {
      feedback.bot.push(item);
    } else if (isReviewBot(author)) {
      const category = categorizeComment(author, body);
      item.review_bot = true;
      feedback[category].push(item);
    } else if (isInfoBot(author)) {
      feedback.bot.push(item);
    } else {
      const category = categorizeComment(author, body);
      feedback[category].push(item);
    }
  }

  // Get review threads (inline comments with resolution status)
  const threadsResult = getReviewThreads(owner, repo, prInfo.number);
  if (!threadsResult.ok) {
    console.log(JSON.stringify({
      error: threadsResult.error,
      partial_threads: threadsResult.threads.length,
      complete: false,
    }, null, 2));
    process.exit(1);
  }
  const threads = threadsResult.threads;

  for (const thread of threads) {
    const comments = thread.comments?.nodes ?? [];
    if (comments.length === 0) continue;

    const comment = [...comments]
      .reverse()
      .find((candidate) => {
        const author = candidate.author?.login ?? "";
        const body = candidate.body ?? "";
        return author !== prAuthor && body.trim().length >= 3;
      });

    if (!comment) continue;

    const author = comment.author?.login ?? "";
    const body = comment.body ?? "";

    if (!body || body.trim().length < 3) continue;

    const item = extractFeedbackItem({
      body,
      author,
      path: thread.path,
      line: thread.line,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      threadId: thread.id,
    });

    if (isNonActionableAck(body)) {
      feedback.resolved.push(item);
    } else if (thread.isResolved || thread.isOutdated) {
      feedback.resolved.push(item);
    } else if (isReviewBot(author)) {
      const category = categorizeComment(author, body);
      item.review_bot = true;
      feedback[category].push(item);
    } else if (isInfoBot(author)) {
      feedback.bot.push(item);
    } else {
      const category = categorizeComment(author, body);
      feedback[category].push(item);
    }
  }

  // Count review bot items across priority buckets
  const reviewBotCount = ["high", "medium", "low"].reduce(
    (acc, bucket) =>
      acc + feedback[bucket].filter((i) => i.review_bot).length,
    0,
  );
  const lowReviewBotCount = feedback.low.filter((i) => i.review_bot).length;
  const needsAttention = feedback.high.length + feedback.medium.length + lowReviewBotCount;

  const output = {
    pr: {
      number: prInfo.number,
      url: prInfo.url ?? "",
      author: prAuthor,
      review_decision: prInfo.reviewDecision ?? "",
    },
    summary: {
      high: feedback.high.length,
      medium: feedback.medium.length,
      low: feedback.low.length,
      bot_comments: feedback.bot.length,
      resolved: feedback.resolved.length,
      review_bot_feedback: reviewBotCount,
      needs_attention: needsAttention,
    },
    feedback,
    complete: true,
    action_required: feedback.high.length
      ? "Address high-priority feedback before merge"
      : feedback.medium.length
        ? "Address medium-priority feedback"
        : lowReviewBotCount
          ? "Evaluate review-bot feedback before merge"
        : feedback.low.length
          ? "Review low-priority suggestions - ask user which to address"
          : null,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
