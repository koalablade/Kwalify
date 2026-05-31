import { createContext, useContext, type ReactNode } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import type { SpotifyUser } from "@workspace/api-client-react";

interface AuthContextValue {
  user: SpotifyUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: true,
      staleTime: 2 * 60 * 1000,
    },
  });

  const isAuthenticated = !!user && !error;

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        isAuthenticated,
        refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
