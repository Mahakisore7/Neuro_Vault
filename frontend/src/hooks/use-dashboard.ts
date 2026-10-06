import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Dashboard } from "@/types/api";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<Dashboard>("/dashboard")).data,
  });
}
