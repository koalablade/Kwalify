import type { PlaylistHistoryItem } from "@workspace/api-client-react";
import { ExternalLink, Music, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface HistoryCardProps {
  item: PlaylistHistoryItem;
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function modeColor(mode: string): string {
  switch (mode) {
    case "strict":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "balanced":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "chaotic":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));

  if (days > 30) return date.toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

export function HistoryCard({ item }: HistoryCardProps) {
  return (
    <div className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-card/80">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Music className="h-5 w-5 text-primary" />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-tight text-foreground">{item.name}</p>
          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
        </div>

        <p className="line-clamp-1 text-sm text-muted-foreground italic">"{item.vibe}"</p>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
              modeColor(item.mode),
            )}
          >
            {modeLabel(item.mode)}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Music className="h-3 w-3" />
            {item.trackCount} tracks
          </span>
          {item.emotionProfile && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              {Math.round(item.emotionProfile.energy * 100)}% energy
            </span>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
        asChild
      >
        <a href={item.playlistUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}
