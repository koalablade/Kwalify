import type { PlaylistResult } from "@workspace/api-client-react";
import { ExternalLink, Music, Zap, Heart, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackCard } from "./track-card";

interface PlaylistResultsProps {
  result: PlaylistResult;
}

function EmotionBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PlaylistResults({ result }: PlaylistResultsProps) {
  const tracks = result.tracks ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Generated playlist
            </p>
            <h2 className="text-xl font-bold text-foreground leading-tight">{result.name}</h2>
            <p className="text-sm text-muted-foreground italic">"{result.vibe}"</p>
          </div>
          <Button asChild className="shrink-0 gap-2">
            <a href={result.playlistUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open in Spotify
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="flex items-center gap-2 text-sm">
            <Music className="h-4 w-4 text-muted-foreground" />
            <span className="text-foreground font-medium">{tracks.length}</span>
            <span className="text-muted-foreground">tracks</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-foreground font-medium capitalize">{result.mode}</span>
            <span className="text-muted-foreground">mode</span>
          </div>
          {result.emotionProfile && (
            <div className="flex items-center gap-2 text-sm">
              <Heart className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground font-medium">
                {Math.round(result.emotionProfile.valence * 100)}%
              </span>
              <span className="text-muted-foreground">mood</span>
            </div>
          )}
        </div>

        {result.emotionProfile && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Emotion profile
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <EmotionBar label="Energy" value={result.emotionProfile.energy} />
              <EmotionBar label="Mood" value={result.emotionProfile.valence} />
              <EmotionBar label="Calm" value={result.emotionProfile.calm} />
              <EmotionBar label="Nostalgia" value={result.emotionProfile.nostalgia} />
            </div>
          </div>
        )}
      </div>

      {tracks.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-3 border-b border-border">
            <p className="text-sm font-medium text-muted-foreground">Tracks</p>
          </div>
          <div className="py-1">
            {tracks.map((track, i) => (
              <TrackCard key={track.id} track={track} index={i + 1} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Wind className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No tracks returned for this vibe.</p>
        </div>
      )}
    </div>
  );
}
