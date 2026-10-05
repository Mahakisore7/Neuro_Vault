import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ActivityEntry, Notification } from "@/types/api";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: () => [...notificationKeys.all, "list"] as const,
  unread: () => [...notificationKeys.all, "unread"] as const,
};

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: async () => (await api.get<{ count: number }>("/notifications/unread-count")).data,
    // Notifications are created by a trigger on someone else's action, so
    // there's no local mutation to invalidate on - poll instead. Cheap: the
    // query is served by the partial unread-only index.
    refetchInterval: 30_000,
    select: (d) => d.count,
  });
}

export function useNotifications({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: async () => (await api.get<Notification[]>("/notifications")).data,
    enabled,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<Notification>(`/notifications/${id}/read`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post("/notifications/read-all");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useActivityFeed() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: async () => (await api.get<ActivityEntry[]>("/activity")).data,
  });
}
