import path from "path";
import { loadIonifyConfig } from "@cli/utils/config";
import { resolveCloudProfile, resolveCloudToken } from "@cli/utils/cloud-auth";
import {
  bindingWarning,
  resolveProjectBinding,
} from "@cli/utils/cloud-binding";
import { CloudApiError, CloudClient, CloudUnreachableError } from "@cli/utils/cloud-client";
import { logError, logInfo, logWarn } from "@cli/utils/logger";
import { resolveWorkspace } from "@core/workspace";

export interface StatusOptions {
  json?: boolean;
}

const EMPTY_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

export async function runStatusCommand(options: StatusOptions = {}): Promise<void> {
  const config = await loadIonifyConfig();
  const cloud = config?.cloud;
  const profile = resolveCloudProfile();
  const token = resolveCloudToken();
  const cwd = process.cwd();
  const rootDir = config?.root ? path.resolve(cwd, config.root) : cwd;
  const workspace = resolveWorkspace(rootDir, { projectRootOverride: rootDir });
  const resolvedBinding = resolveProjectBinding(workspace);
  const binding = resolvedBinding?.binding ?? null;
  const bindingWarn = resolvedBinding ? bindingWarning(resolvedBinding) : null;
  const configuredProjectId = cloud?.projectId === EMPTY_PROJECT_ID ? undefined : cloud?.projectId;
  const apiUrl = binding?.apiUrl ?? profile?.apiUrl ?? cloud?.apiUrl ?? "https://api.ionify.cloud";
  const projectId = binding?.projectId ?? configuredProjectId ?? null;

  let cloudState: "not_checked" | "reachable" | "unauthorized" | "unreachable" | "error" = "not_checked";
  let cloudMessage: string | null = null;
  let usage: unknown = null;

  if (token && projectId) {
    const client = new CloudClient({
      apiUrl,
      token,
      projectId,
      binding: binding ?? undefined,
    });
    try {
      usage = await client.getUsage();
      cloudState = "reachable";
    } catch (err) {
      if (err instanceof CloudUnreachableError) {
        cloudState = "unreachable";
        cloudMessage = err.message;
      } else if (err instanceof CloudApiError && (err.statusCode === 401 || err.statusCode === 403)) {
        cloudState = "unauthorized";
        cloudMessage = `Cloud API rejected the token for project ${projectId}.`;
      } else if (err instanceof Error) {
        cloudState = "error";
        cloudMessage = err.message;
      } else {
        cloudState = "error";
        cloudMessage = String(err);
      }
    }
  }

  const payload = {
    cwd,
    apiUrl,
    hasToken: Boolean(token),
    tokenSource: process.env.IONIFY_CLOUD_TOKEN ? "IONIFY_CLOUD_TOKEN" : token ? "~/.ionify/credentials.json" : null,
    projectId,
    configuredProjectId: configuredProjectId ?? null,
    binding: binding
      ? {
          projectId: binding.projectId,
          projectSlug: binding.projectSlug,
          bindingType: binding.bindingType,
          fingerprint: binding.fingerprint,
          normalizedRemote: binding.normalizedRemote,
          workspaceRelPath: binding.workspaceRelPath,
          localProjectRelPath: binding.localProjectRelPath,
          createdAt: binding.createdAt,
          updatedAt: binding.updatedAt,
        }
      : null,
    bindingWarning: bindingWarn,
    cloud: {
      state: cloudState,
      message: cloudMessage,
      usage,
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  logInfo("Ionify Cloud status");
  logInfo(`  cwd          : ${cwd}`);
  logInfo(`  api_url      : ${apiUrl}`);
  logInfo(`  token        : ${payload.hasToken ? `found (${payload.tokenSource})` : "missing"}`);
  logInfo(`  project_id   : ${projectId ?? "not bound"}`);
  if (configuredProjectId && binding && configuredProjectId !== binding.projectId) {
    logWarn(`config project_id differs from binding: ${configuredProjectId}`);
  }

  if (binding) {
    logInfo(`  binding      : ${binding.bindingType}`);
    logInfo(`  project_slug : ${binding.projectSlug}`);
    logInfo(`  workspace    : ${binding.workspaceRelPath}`);
    if (binding.normalizedRemote) logInfo(`  git_remote   : ${binding.normalizedRemote}`);
    if (binding.fingerprint) logInfo(`  fingerprint  : ${binding.fingerprint.slice(0, 16)}…`);
    if (bindingWarn) logWarn(bindingWarn);
  } else {
    logWarn("No project binding found. Run `ionify bind --project <project-id>` from this project root.");
  }

  if (!token) {
    logWarn("Cloud check skipped: no token found. Run `ionify login --token <token>`.");
  } else if (!projectId) {
    logWarn("Cloud check skipped: no project binding found.");
  } else if (cloudState === "reachable") {
    logInfo("  cloud        : reachable");
  } else {
    logError(`  cloud        : ${cloudState}${cloudMessage ? ` — ${cloudMessage}` : ""}`);
  }
}
