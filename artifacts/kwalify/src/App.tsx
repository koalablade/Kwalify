import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { HistoryPage } from "@/pages/history";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Spotify login. Try again when you're ready.",
  invalid_state: "Login session expired. Please try again.",
  no_code: "Spotify didn't return an auth code. Please try again.",
  token_exchange_failed: "Could not connect to Spotify. Please try again.",
  no_session: "Session error. Please clear cookies and try again.",
};

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const message =
        OAUTH_ERROR_MESSAGES[error] ?? "Login failed. Please try again.";
      toast({
        title: "Could not sign in",
        description: message,
        variant: "destructive",
      });
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/history" component={HistoryPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
