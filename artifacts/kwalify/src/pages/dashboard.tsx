import { useState } from "react";
import { Link } from "wouter";
import { useAuthLogout } from "@workspace/api-client-react";
import type { PlaylistResult } from "@workspace/api-client-react";
import { History, LogOut, Music2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SyncStatus } from "@/components/kwalify/sync-status";
import { GenerateForm } from "@/components/kwalify/generate-form";
import { PlaylistResults } from "@/components/kwalify/playlist-results";
import { useAuth } from "@/contexts/auth-context";

function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<PlaylistResult | null>(null);

  const logout = useAuthLogout({
    mutation: {
      onSuccess: () => {
        window.location.href = "/";
      },
    },
  });

  const displayName = user?.displayName ?? "Listener";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Music2 className="h-5 w-5 text-primary" />
            <span className="font-bold text-foreground">Kwalify</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground">
              <Link href="/history">
                <History className="h-4 w-4" />
                History
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 pl-2 pr-1">
                  <Avatar name={displayName} url={user?.avatarUrl} />
                  <span className="max-w-[120px] truncate text-sm">{displayName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {user?.email && (
                  <>
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">
            What's the vibe, {displayName.split(" ")[0]}?
          </h1>
          <p className="text-muted-foreground text-sm">
            Describe your mood and Kwalify builds the perfect playlist from your library.
          </p>
        </div>

        <SyncStatus />

        <div className="rounded-xl border border-border bg-card p-6">
          <GenerateForm
            onResult={(r) => {
              setResult(r);
              setTimeout(() => {
                document.getElementById("kwalify-results")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }, 100);
            }}
          />
        </div>

        {result && (
          <div id="kwalify-results">
            <PlaylistResults result={result} />
          </div>
        )}
      </main>
    </div>
  );
}
