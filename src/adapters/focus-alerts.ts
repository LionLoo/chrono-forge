import { isTauri } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

import type { AppSettings } from './persistence';
import { getGameSoundscape, type GameSoundscape } from './soundscape';

const COMPLETION_NOTIFICATION = {
  title: 'Focus complete',
  body: 'Your focus session is complete.',
} as const;

/** Non-authoritative completion effects that React can replace in tests or previews. */
export interface FocusAlerts {
  notifyCompletion(settings: AppSettings): Promise<void>;
}

export interface BrowserNotificationConstructor {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): Notification;
}

export interface NativeNotificationApi {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<NotificationPermission>;
  sendNotification(options: { readonly title: string; readonly body: string }): void;
}

export interface FocusAlertsDependencies {
  readonly detectTauri?: () => boolean;
  readonly nativeNotifications?: NativeNotificationApi;
  readonly browserNotifications?: BrowserNotificationConstructor | undefined;
  readonly soundscape?: GameSoundscape;
}

const nativeNotifications: NativeNotificationApi = {
  isPermissionGranted,
  requestPermission,
  sendNotification,
};

/**
 * Creates a best-effort adapter for effects outside the simulation and save
 * boundaries. Alert failures are intentionally contained at this edge.
 */
export function createFocusAlerts(dependencies: FocusAlertsDependencies = {}): FocusAlerts {
  const detectTauri = dependencies.detectTauri ?? isTauri;
  const native = dependencies.nativeNotifications ?? nativeNotifications;
  const browser = dependencies.browserNotifications ?? globalThis.Notification;
  const soundscape = dependencies.soundscape ?? getGameSoundscape();

  return {
    async notifyCompletion(settings) {
      if (settings.notificationsEnabled) {
        await runBestEffort(async () => {
          if (detectTauri()) {
            await notifyNative(native);
          } else {
            await notifyBrowser(browser);
          }
        });
      }

      if (settings.soundEnabled && settings.volumePercent > 0) {
        await runBestEffort(() => soundscape.playCue('focus-complete', settings));
      }
    },
  };
}

async function notifyNative(notifications: NativeNotificationApi): Promise<void> {
  let permissionGranted = await notifications.isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await notifications.requestPermission()) === 'granted';
  }
  if (permissionGranted) {
    notifications.sendNotification(COMPLETION_NOTIFICATION);
  }
}

async function notifyBrowser(
  notifications: BrowserNotificationConstructor | undefined,
): Promise<void> {
  if (notifications === undefined || notifications.permission === 'denied') return;

  let permission: NotificationPermission = notifications.permission;
  if (permission === 'default') {
    permission = await notifications.requestPermission();
  }
  if (permission === 'granted') {
    new notifications(COMPLETION_NOTIFICATION.title, { body: COMPLETION_NOTIFICATION.body });
  }
}

async function runBestEffort(effect: () => void | Promise<void>): Promise<void> {
  try {
    await effect();
  } catch {
    // Completion feedback must never change application behavior.
  }
}

let sharedFocusAlerts: FocusAlerts | null = null;

/** Returns the process-local production alert adapter for React injection. */
export function getFocusAlerts(): FocusAlerts {
  sharedFocusAlerts ??= createFocusAlerts();
  return sharedFocusAlerts;
}
