// Notification service: in-app toasts + browser native notifications
// In-app: shown via NotificationToaster component bottom-right
// Browser: requires user permission, fires when window not focused

interface Notification {
  id: string;
  type: 'parlay' | 'reversal' | 'line_move' | 'info';
  title: string;
  body: string;
  ts: number;
  url?: string;
}

type Listener = (notifications: Notification[]) => void;

class NotificationService {
  private items: Notification[] = [];
  private listeners: Set<Listener> = new Set();
  private permission: 'default' | 'granted' | 'denied' = 'default';
  private seenKeys: Set<string> = new Set(); // for dedupe

  constructor() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permission = Notification.permission as any;
    }
  }

  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (this.permission === 'granted') return true;
    try {
      const result = await Notification.requestPermission();
      this.permission = result as any;
      return result === 'granted';
    } catch { return false; }
  }

  hasPermission() { return this.permission === 'granted'; }
  permissionState() { return this.permission; }

  // Show a notification. dedupeKey prevents repeat firing for same event.
  push(n: Omit<Notification, 'id' | 'ts'>, dedupeKey?: string) {
    if (dedupeKey && this.seenKeys.has(dedupeKey)) return;
    if (dedupeKey) this.seenKeys.add(dedupeKey);

    const item: Notification = {
      ...n,
      id: Math.random().toString(36).slice(2, 9),
      ts: Date.now(),
    };
    this.items = [item, ...this.items].slice(0, 20); // keep last 20
    this.emit();

    // Fire browser notification only when document is hidden (user is on another tab)
    if (this.permission === 'granted' && document.hidden) {
      try {
        new window.Notification(n.title, { body: n.body, icon: '/favicon.ico', tag: dedupeKey });
      } catch {}
    }
  }

  dismiss(id: string) {
    this.items = this.items.filter(i => i.id !== id);
    this.emit();
  }

  clearAll() {
    this.items = [];
    this.emit();
  }

  list() { return this.items; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.items);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach(fn => fn(this.items));
  }
}

export const notifications = new NotificationService();

// React hook
import { useState, useEffect } from 'react';

export function useNotifications() {
  const [items, setItems] = useState(notifications.list());
  useEffect(() => notifications.subscribe(setItems), []);
  return {
    items,
    push: notifications.push.bind(notifications),
    dismiss: notifications.dismiss.bind(notifications),
    clearAll: notifications.clearAll.bind(notifications),
    requestPermission: notifications.requestPermission.bind(notifications),
    hasPermission: notifications.hasPermission(),
    permissionState: notifications.permissionState(),
  };
}
