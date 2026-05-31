import { useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 300;

const EXAMPLES = [
  "2am drive through empty streets, windows down",
  "sunday morning coffee and slow rain outside",
  "studying but make it feel cinematic and vast",
  "heartbreak that feels like a long walk home",
  "pre-game energy — focused, sharp, unstoppable",
];

interface VibeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function VibeInput({ value, onChange, disabled }: VibeInputProps) {
  const id = useId();
  const placeholder = EXAMPLES[Math.floor(Date.now() / 60000) % EXAMPLES.length];
  const remaining = MAX_LENGTH - value.length;
  const isNearLimit = remaining <= 50;
  const isAtLimit = remaining <= 0;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Describe your vibe
      </label>
      <div className="relative">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          className="resize-none pr-16 text-base leading-relaxed placeholder:text-muted-foreground/60"
        />
        <span
          className={cn(
            "absolute bottom-3 right-3 text-xs tabular-nums transition-colors",
            isAtLimit
              ? "text-destructive font-medium"
              : isNearLimit
                ? "text-amber-400"
                : "text-muted-foreground/50",
          )}
        >
          {remaining}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Be specific — emotions, time of day, setting, and energy level all help.
      </p>
    </div>
  );
}
