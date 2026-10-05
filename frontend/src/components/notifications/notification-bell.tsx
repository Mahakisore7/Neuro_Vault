"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/use-notifications";
import { timeAgo } from "@/lib/time";
import type { Notification } from "@/types/api";

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  const { data: notifications, isLoading } = useNotifications({ enabled: open });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  function handleOpen(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link_url) router.push(n.link_url);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !notifications || notifications.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs text-muted-foreground">
                You&rsquo;ll hear here when someone links to one of your public notes.
              </p>
            </div>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpen(n)}
                    className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-muted"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        n.is_read ? "bg-transparent" : "bg-primary"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.is_read ? "" : "font-medium"}`}>
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="block text-xs text-muted-foreground">{n.body}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
