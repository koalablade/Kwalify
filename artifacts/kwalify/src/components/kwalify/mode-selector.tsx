import type { PlaylistRequestMode } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const MODES: {
  value: PlaylistRequestMode;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "strict",
    label: "Strict",
    description: "Tight precision. Exactly your vibe.",
    color: "data-[active=true]:border-blue-500 data-[active=true]:bg-blue-500/10 data-[active=true]:text-blue-400",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Precision meets discovery. The DJ's pick.",
    color: "data-[active=true]:border-emerald-500 data-[active=true]:bg-emerald-500/10 data-[active=true]:text-emerald-400",
  },
  {
    value: "chaotic",
    label: "Chaotic",
    description: "Loosely matched. Maximum surprise.",
    color: "data-[active=true]:border-purple-500 data-[active=true]:bg-purple-500/10 data-[active=true]:text-purple-400",
  },
];

interface ModeSelectorProps {
  value: PlaylistRequestMode;
  onChange: (value: PlaylistRequestMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ value, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">Mode</label>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            disabled={disabled}
            data-active={value === mode.value}
            onClick={() => onChange(mode.value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left transition-all",
              "hover:border-border/80 hover:bg-muted/50",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode.color,
            )}
          >
            <span className="text-sm font-semibold">{mode.label}</span>
            <span className="text-xs text-muted-foreground leading-tight">{mode.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
