import type { PlaylistTrack } from "@workspace/api-client-react";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrackCardProps {
  track: PlaylistTrack;
  index: number;
}

function formatDuration(ms?: number): string {
  if (!ms) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function EnergyDot({ value }: { value?: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color =
    pct >= 75
      ? "bg-emerald-400"
      : pct >= 50
        ? "bg-yellow-400"
        : pct >= 25
          ? "bg-orange-400"
          : "bg-muted-foreground";
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {pct}%
    </span>
  );
}

export function TrackCard({ track, index }: TrackCardProps) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50">
      <span className="w-6 shrink-0 text-center text-sm text-muted-foreground group-hover:hidden">
        {index}
      </span>
      <span className="hidden w-6 shrink-0 items-center justify-center group-hover:flex">
        <Music className="h-3.5 w-3.5 text-muted-foreground" />
      </span>

      {track.albumArt ? (
        <img
          src={track.albumArt}
          alt={track.album}
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
          <Music className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{track.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {track.artist}
          {track.album && ` · ${track.album}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <EnergyDot value={track.energy} />
        <span className="text-xs text-muted-foreground">{formatDuration(track.durationMs)}</span>
      </div>
    </div>
  );
}
