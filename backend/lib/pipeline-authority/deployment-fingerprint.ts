import { deploymentVersion } from "../deployment-version";

export const PIPELINE_AUTHORITY_VERSION = 1;

/** True when this build includes Pipeline Authority wiring in generation.controller. */
export function isPipelineAuthorityEnabledInBuild(): boolean {
  return true;
}

export function pipelineDeploymentFingerprint(): {
  commit: string;
  buildTimestamp: string | null;
  pipelineAuthorityEnabled: boolean;
  pipelineAuthorityVersion: number;
} {
  const buildTimestamp =
    process.env["BUILD_TIMESTAMP"]?.trim() ||
    process.env["RENDER_GIT_COMMIT_CREATED_AT"]?.trim() ||
    process.env["SOURCE_VERSION_CREATED_AT"]?.trim() ||
    null;

  return {
    commit: deploymentVersion(),
    buildTimestamp,
    pipelineAuthorityEnabled: isPipelineAuthorityEnabledInBuild(),
    pipelineAuthorityVersion: PIPELINE_AUTHORITY_VERSION,
  };
}

export type DeploymentMismatchError = {
  message: string;
  expectedCommit: string;
  actualCommit: string;
  pipelineAuthorityEnabled: boolean;
};

export function assertPipelineAuthorityDeployment(
  expectedCommit: string,
  actual: {
    commit: string;
    pipelineAuthority?: { enabled?: boolean } | null;
  },
): void {
  const enabled = actual.pipelineAuthority?.enabled === true;
  if (!enabled) {
    throw new Error(
      `Pipeline Authority verification aborted: running deployment does not expose pipelineAuthority.enabled on /api/readyz (commit=${actual.commit}). Rebuild and restart the API.`,
    );
  }
  if (expectedCommit && actual.commit !== expectedCommit) {
    throw new Error(
      `Pipeline Authority verification aborted: expected ${expectedCommit} received ${actual.commit}`,
    );
  }
}
