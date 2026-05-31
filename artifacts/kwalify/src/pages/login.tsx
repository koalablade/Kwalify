import { Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const SPOTIFY_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.52 17.28c-.24.36-.72.48-1.08.24-2.88-1.8-6.6-2.16-10.92-1.2-.396.12-.84-.12-.96-.516-.12-.396.12-.84.516-.96 4.68-1.08 8.76-.6 12 1.44.396.216.504.72.24 1.08l.204-.084zm1.44-3.24c-.3.456-.9.6-1.356.3-3.3-2.04-8.28-2.64-12.18-1.44-.492.144-1.008-.132-1.14-.624-.144-.492.132-1.008.624-1.14 4.44-1.356 9.96-.696 13.8 1.656.444.3.588.9.3 1.356l-.048-.108zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.236-.156-1.416-.756-.18-.6.156-1.236.756-1.416 4.2-1.284 11.22-1.02 15.66 1.62.54.324.708 1.02.384 1.548-.312.54-1.02.708-1.548.384l.084-.012z" />
  </svg>
);

const VIBES = [
  "2am drive through empty streets",
  "sunday morning slow rain",
  "studying in a vast cathedral",
  "heartbreak in slow motion",
  "unstoppable pre-game energy",
];

export function LoginPage() {
  const handleLogin = () => {
    window.location.href = "/api/auth/login";
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-10 text-center">
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
              <Music2 className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Kwalify</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Your emotional AI Spotify DJ
          </p>
          <p className="text-sm text-muted-foreground/70">
            Describe how you feel and Kwalify builds the perfect playlist
            from your liked songs — no algorithm guessing, pure vibe matching.
          </p>
        </div>

        <div className="space-y-3 text-left rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Example vibes</p>
          <ul className="space-y-2">
            {VIBES.map((v) => (
              <li key={v} className="flex items-start gap-2 text-sm text-foreground/80">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="italic">"{v}"</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full gap-3 text-base font-semibold h-12"
            onClick={handleLogin}
          >
            {SPOTIFY_ICON}
            Connect with Spotify
          </Button>
          <p className="text-xs text-muted-foreground">
            Kwalify only reads your liked songs and creates private playlists.
            Your data stays yours.
          </p>
        </div>
      </div>
    </div>
  );
}
