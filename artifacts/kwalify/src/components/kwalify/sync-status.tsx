import { useEffect, useState } from "react";
import { useGetCacheStatus, useSyncLikedSongs, getGetCacheStatusQueryKey } from "@workspace/api-client-react";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function SyncStatus() {
  const [polling, setPolling] = useState<number | false>(false);

  const {
    data: status,
    isLoading,
    isError,
  } = useGetCacheStatus({
    query: {
      queryKey: getGetCacheStatusQueryKey(),
      refetchInterval: polling,
      retry: false,
      staleTime: 10_000,
    },
  });

  const sync = useSyncLikedSongs({
    mutation: {
      onSuccess: () => {
        setPolling(2000);
      },
    },
  });

  useEffect(() => {
    if (status?.isSyncing) {
      setPolling(2000);
    } else {
      setPolling(false);
    }
  }, [status?.isSyncing]);

  if (isLoading) return null;
  if (isError) return null;
  if (!status) return null;

  if (status.synced && !status.isSyncing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <span className="text-sm text-emerald-400">
          Library synced — {status.totalTracks.toLocaleString()} tracks ready
        </span>
      </div>
    );
  }

  if (status.isSyncing) {
    const progress =
      status.syncTotal && status.syncProgress != null
        ? Math.round((status.syncProgress / status.syncTotal) * 100)
        : null;

    return (
      <div className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="text-sm font-medium text-foreground">Syncing your library…</span>
          {status.syncProgress != null && status.syncTotal && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {status.syncProgress.toLocaleString()} / {status.syncTotal.toLocaleString()}
            </span>
          )}
        </div>
        {progress != null && (
          <Progress value={progress} className="h-1.5" />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm text-amber-400">
          {status.totalTracks > 0
            ? `${status.totalTracks.toLocaleString()} tracks cached — sync for latest`
            : "Sync your Spotify library to get started"}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => sync.mutate()}
        disabled={sync.isPending}
        className="shrink-0 gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
      >
        {sync.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Sync now
      </Button>
    </div>
  );
}
