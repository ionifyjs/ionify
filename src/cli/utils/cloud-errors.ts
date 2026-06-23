import { CloudApiError } from "./cloud-client.js";

export type CloudQuotaKind =
  | "storage"
  | "monthly_write_ops"
  | "monthly_read_ops"
  | "blob_write_rate"
  | "meta_write_rate"
  | "member_count"
  | "unknown";

export type CloudQuotaDetails = {
  kind: CloudQuotaKind;
  scope: "Workspace" | "Project";
  reason: string;
  usage: string | null;
  retry: string | null;
  retryable: boolean;
};

export function isCloudQuotaError(error: unknown): error is CloudApiError {
  return error instanceof CloudApiError && error.statusCode === 429;
}

export function quotaDetails(error: CloudApiError): CloudQuotaDetails {
  const body = error.parsedBody;
  const message = body.message ?? error.body;
  const kind = inferQuotaKind(body.limit_kind, message);
  const usage = formatQuotaUsage(body.current_value, body.limit_value) ?? inferQuotaUsage(message);
  const retry =
    body.retry_after_secs && body.retry_after_secs > 0
      ? `${body.retry_after_secs}s`
      : extractRetryHint(message);
  return {
    kind,
    scope: body.scope === "workspace" ? "Workspace" : "Project",
    reason: formatQuotaReason(kind, message),
    usage,
    retry,
    retryable: body.retryable === true,
  };
}

export function formatCloudQuotaError(
  command: string,
  action: string,
  error: CloudApiError,
): string {
  const details = quotaDetails(error);
  return (
    `${command} stopped: Ionify Cloud limit reached.\n` +
    `  Action : ${action}\n` +
    `  Scope  : ${details.scope} quota shared by the owner and members\n` +
    `  Limit  : ${details.reason}\n` +
    (details.usage ? `  Usage  : ${details.usage}\n` : "") +
    (details.retry
      ? `  Retry  : wait about ${details.retry}, then retry the command.\n`
      : "  Retry  : this limit does not reset in seconds; free usage or change the workspace plan.\n") +
    "  Billing: open Usage & billing to see storage, reads, writes, and member limits."
  );
}

export function formatCloudAuthError(command: string): string {
  return (
    `${command} failed: the saved Ionify Cloud session is not authorized.\n` +
    `  Run \`ionify login\`, then retry \`${command}\` for this project.`
  );
}

function inferQuotaKind(limitKind: string | undefined, message: string): CloudQuotaKind {
  if (isKnownQuotaKind(limitKind)) return limitKind;
  if (/blob_write rate limit exceeded|source\/blob upload burst/i.test(message)) return "blob_write_rate";
  if (/meta_write rate limit exceeded|metadata write burst/i.test(message)) return "meta_write_rate";
  if (/monthly write limit exceeded/i.test(message)) return "monthly_write_ops";
  if (/monthly read limit exceeded/i.test(message)) return "monthly_read_ops";
  if (/storage limit/i.test(message)) return "storage";
  if (/member limit/i.test(message)) return "member_count";
  return "unknown";
}

function isKnownQuotaKind(value: string | undefined): value is CloudQuotaKind {
  return (
    value === "storage" ||
    value === "monthly_write_ops" ||
    value === "monthly_read_ops" ||
    value === "blob_write_rate" ||
    value === "meta_write_rate" ||
    value === "member_count"
  );
}

function formatQuotaReason(kind: CloudQuotaKind, message: string): string {
  if (kind === "blob_write_rate") {
    return "source/blob upload burst rate exceeded (per-minute writes), not storage.";
  }
  if (kind === "meta_write_rate") return "metadata write burst rate exceeded (per-minute metadata ops).";
  if (kind === "monthly_write_ops") return "monthly write quota exceeded.";
  if (kind === "monthly_read_ops") return "monthly read quota exceeded.";
  if (kind === "storage") return "artifact storage quota exceeded.";
  if (kind === "member_count") return "workspace member limit exceeded.";
  return message.replace(/^quota exceeded:\s*/i, "").trim() || "plan quota exceeded.";
}

function formatQuotaUsage(current?: number, limit?: number): string | null {
  if (typeof current !== "number" || typeof limit !== "number") return null;
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

function inferQuotaUsage(message: string): string | null {
  const match = message.match(/\((\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+(?:rolling\s+30d\s+)?(?:read|write)?\s*ops?\)/i);
  if (!match) return null;
  return `${match[1]} / ${match[2]}`;
}

function extractRetryHint(message: string): string | null {
  const match = message.match(/retry in ~?(\d+)s/i);
  if (!match) return null;
  return `${match[1]}s`;
}
