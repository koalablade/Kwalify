import { useGetHistory, getGetHistoryQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Clock, Music } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { HistoryCard } from "@/components/kwalify/history-card";
import { ErrorState } from "@/components/kwalify/error-state";

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-xl border border-border bg-card animate-pulse"
        />
      ))}
    </div>
  );
}

export function HistoryPage() {
  const { data: history, isLoading, isError, refetch } = useGetHistory({
    query: {
      queryKey: getGetHistoryQueryKey(),
      retry: 1,
      staleTime: 60_000,
    },
  });

  const items = history ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-9 w-9">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">History</h1>
            <p className="text-sm text-muted-foreground">Your generated playlists</p>
          </div>
        </div>

        {isLoading && <HistorySkeleton />}

        {isError && (
          <ErrorState
            title="Could not load history"
            message="There was a problem fetching your playlist history."
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">No playlists yet</p>
              <p className="text-sm text-muted-foreground">
                Generate your first playlist and it'll show up here.
              </p>
            </div>
            <Button asChild>
              <Link href="/">Generate a playlist</Link>
            </Button>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Music className="h-4 w-4" />
              <span>{items.length} playlist{items.length !== 1 ? "s" : ""}</span>
            </div>
            {items.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
