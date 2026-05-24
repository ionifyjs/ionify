import type { NodeEnvTag } from "@cli/utils/cloud-env";

export interface PushTargetDescriptor {
  nodeEnv: NodeEnvTag;
  depsHash: string;
  configHash: string;
  depsRoot: string;
}

export interface PushTargetProbe extends PushTargetDescriptor {
  hasVerified: boolean;
  hasDevStable: boolean;
  hasCommittedCloudSession: boolean;
  committedCloudSessionId: string | null;
  committedCloudArtifactCount: number | null;
  committedCloudTotalBytes: number | null;
}

export type Tier2Disposition =
  | "upload-local-snapshot"
  | "reuse-committed-cloud-session";

export interface PreparedPushTarget extends PushTargetDescriptor {
  source: "local-verified" | "cloud-committed";
  tier2Disposition: Tier2Disposition;
  committedCloudSessionId: string | null;
  committedCloudArtifactCount: number | null;
  committedCloudTotalBytes: number | null;
}

export function selectPreparedPushTargets(
  probes: PushTargetProbe[],
): PreparedPushTarget[] {
  const out: PreparedPushTarget[] = [];
  for (const probe of probes) {
    if (probe.hasCommittedCloudSession) {
      out.push({
        nodeEnv: probe.nodeEnv,
        depsHash: probe.depsHash,
        configHash: probe.configHash,
        depsRoot: probe.depsRoot,
        source: "cloud-committed",
        tier2Disposition: "reuse-committed-cloud-session",
        committedCloudSessionId: probe.committedCloudSessionId,
        committedCloudArtifactCount: probe.committedCloudArtifactCount,
        committedCloudTotalBytes: probe.committedCloudTotalBytes,
      });
      continue;
    }

    if (probe.hasVerified) {
      out.push({
        nodeEnv: probe.nodeEnv,
        depsHash: probe.depsHash,
        configHash: probe.configHash,
        depsRoot: probe.depsRoot,
        source: "local-verified",
        tier2Disposition: "upload-local-snapshot",
        committedCloudSessionId: probe.committedCloudSessionId,
        committedCloudArtifactCount: probe.committedCloudArtifactCount,
        committedCloudTotalBytes: probe.committedCloudTotalBytes,
      });
    }
  }
  return out;
}

export function needsDependencyPreparation(probes: PushTargetProbe[]): boolean {
  return selectPreparedPushTargets(probes).length === 0;
}

export function hasLocalSnapshotEvidence(probes: PushTargetProbe[]): boolean {
  return probes.some((probe) => probe.hasVerified || probe.hasDevStable);
}
