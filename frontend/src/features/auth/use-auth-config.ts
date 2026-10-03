import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/api/http/client";
export type PublicConfig = {
  db_reset_notice_date?: string | null;
  auth?: {
    google_enabled: boolean;
    signup_enabled: boolean;
    password_reset_enabled: boolean;
    password_min_length: number;
    support_email: string;
  };
};
export function useAuthConfig() {
  return useQuery({
    queryKey: ["config", "public"],
    queryFn: () => requestJson<PublicConfig>("/config/public"),
    staleTime: 60_000,
    retry: false,
  });
}
