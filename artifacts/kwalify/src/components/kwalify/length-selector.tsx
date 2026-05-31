import { useId } from "react";
import { Slider } from "@/components/ui/slider";

const MIN = 10;
const MAX = 50;

interface LengthSelectorProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function LengthSelector({ value, onChange, disabled }: LengthSelectorProps) {
  const id = useId();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          Playlist length
        </label>
        <span className="text-sm font-semibold tabular-nums text-primary">
          {value} tracks
        </span>
      </div>
      <Slider
        id={id}
        min={MIN}
        max={MAX}
        step={5}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? value)}
        disabled={disabled}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{MIN} min</span>
        <span>{MAX} max</span>
      </div>
    </div>
  );
}
