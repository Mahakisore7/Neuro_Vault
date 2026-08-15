import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { UserResponse, UserUpdate } from "@/types/api";

export const userKeys = {
  me: ["users", "me"] as const,
};

export function useMe() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn: async () => (await api.get<UserResponse>("/users/me")).data,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UserUpdate) =>
      (await api.patch<UserResponse>("/users/me", payload)).data,
    onSuccess: (user) => qc.setQueryData(userKeys.me, user),
  });
}
