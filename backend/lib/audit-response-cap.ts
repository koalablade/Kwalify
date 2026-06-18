/**
 * Cap eval/audit JSON payloads so large library diagnostics don't blow response sizes.
 */

const MAX_AUDIT_TRACKS = Number.parseInt(process.env["EVAL_AUDIT_MAX_TRACKS"] ?? "40", 10);
const MAX_STAGE_TRACE = Number.parseInt(process.env["EVAL_AUDIT_MAX_STAGE_TRACE"] ?? "24", 10);
const MAX_ARRAY_ITEMS = Number.parseInt(process.env["EVAL_AUDIT_MAX_ARRAY_ITEMS"] ?? "40", 10);

function capArray<T>(items: T[] | null | undefined, max: number): T[] | undefined {
  if (!Array.isArray(items)) return items ?? undefined;
  if (items.length <= max) return items;
  return items.slice(0, max);
}

export function capAuditResponsePayload<T extends Record<string, unknown>>(payload: T): T {
  const tracks = payload["tracks"];
  if (Array.isArray(tracks) && tracks.length > MAX_AUDIT_TRACKS) {
    payload = {
      ...payload,
      tracks: tracks.slice(0, MAX_AUDIT_TRACKS),
      auditPayloadCap: {
        tracksTruncated: true,
        originalTrackCount: tracks.length,
        maxTracks: MAX_AUDIT_TRACKS,
      },
    };
  }

  const intentSurvival = payload["intentSurvival"];
  if (intentSurvival && typeof intentSurvival === "object") {
    const survival = intentSurvival as Record<string, unknown>;
    payload = {
      ...payload,
      intentSurvival: {
        ...survival,
        stageTrace: capArray(survival["stageTrace"] as unknown[] | undefined, MAX_STAGE_TRACE),
        stageByStageLog: capArray(survival["stageByStageLog"] as unknown[] | undefined, MAX_STAGE_TRACE),
        leakDetections: capArray(survival["leakDetections"] as unknown[] | undefined, MAX_ARRAY_ITEMS),
        relaxationAudit: capArray(survival["relaxationAudit"] as unknown[] | undefined, MAX_ARRAY_ITEMS),
      },
    };
  }

  const v3Diagnostics = payload["v3Diagnostics"];
  if (v3Diagnostics && typeof v3Diagnostics === "object") {
    const v3 = v3Diagnostics as Record<string, unknown>;
    payload = {
      ...payload,
      v3Diagnostics: {
        ...v3,
        selectionTrace: capArray(v3["selectionTrace"] as unknown[] | undefined, MAX_ARRAY_ITEMS),
        preV3TopCandidates: capArray(v3["preV3TopCandidates"] as unknown[] | undefined, MAX_ARRAY_ITEMS),
      },
    };
  }

  const generationDiagnostics = payload["generationDiagnostics"];
  if (generationDiagnostics && typeof generationDiagnostics === "object") {
    const diag = generationDiagnostics as Record<string, unknown>;
    payload = {
      ...payload,
      generationDiagnostics: {
        ...diag,
        stageProfile: diag["stageProfile"],
        productionTimeline: diag["productionTimeline"],
      },
    };
  }

  return payload;
}
