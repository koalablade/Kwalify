import { useState } from "react";
import {
  useGeneratePlaylist,
  PlaylistRequestMode,
  type PlaylistResult,
} from "@workspace/api-client-react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeInput } from "./vibe-input";
import { ModeSelector } from "./mode-selector";
import { LengthSelector } from "./length-selector";
import { ErrorState } from "./error-state";

interface GenerateFormProps {
  onResult: (result: PlaylistResult) => void;
}

function getErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "An unexpected error occurred.";
  const e = err as Record<string, unknown>;
  if (typeof e["message"] === "string") return e["message"];
  return "Failed to generate playlist. Please try again.";
}

export function GenerateForm({ onResult }: GenerateFormProps) {
  const [vibe, setVibe] = useState("");
  const [mode, setMode] = useState<PlaylistRequestMode>(PlaylistRequestMode.balanced);
  const [length, setLength] = useState(25);

  const generate = useGeneratePlaylist({
    mutation: {
      onSuccess: (result) => {
        onResult(result);
      },
    },
  });

  const canSubmit = vibe.trim().length > 0 && !generate.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    generate.reset();
    generate.mutate({ data: { vibe: vibe.trim(), mode, length } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <VibeInput value={vibe} onChange={setVibe} disabled={generate.isPending} />
      <ModeSelector value={mode} onChange={setMode} disabled={generate.isPending} />
      <LengthSelector value={length} onChange={setLength} disabled={generate.isPending} />

      {generate.isError && (
        <ErrorState
          title="Generation failed"
          message={getErrorMessage(generate.error)}
          onRetry={() => generate.reset()}
        />
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full gap-2 h-12 text-base font-semibold"
        disabled={!canSubmit}
      >
        {generate.isPending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Building your playlist…
          </>
        ) : (
          <>
            <Sparkles className="h-5 w-5" />
            Generate playlist
          </>
        )}
      </Button>

      {generate.isPending && (
        <p className="text-center text-xs text-muted-foreground animate-pulse">
          Analyzing your vibe and matching tracks from your library…
        </p>
      )}
    </form>
  );
}
