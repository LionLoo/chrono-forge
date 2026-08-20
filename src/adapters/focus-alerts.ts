import { isTauri } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

import type { AppSettings } from './persistence';

const COMPLETION_NOTIFICATION = {
  title: 'Focus complete',
  body: 'Your focus session is complete.',
} as const;
const TONE_FREQUENCY_HZ = 880;
const TONE_DURATION_SECONDS = 0.16;
const TONE_ATTACK_SECONDS = 0.01;

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
  readonly createAudioContext?: () => AudioContext;
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
  const createAudioContext = dependencies.createAudioContext ?? (() => new AudioContext());

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
        await runBestEffort(() => playCompletionTone(createAudioContext, settings.volumePercent));
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

function playCompletionTone(createAudioContext: () => AudioContext, volumePercent: number): void {
  const volume = Math.min(Math.max(volumePercent, 0), 100) / 100;
  if (!Number.isFinite(volume) || volume <= 0) return;

  const context = createAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime;
  const endAt = startAt + TONE_DURATION_SECONDS;

  oscillator.frequency.setValueAtTime(TONE_FREQUENCY_HZ, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + TONE_ATTACK_SECONDS);
  gain.gain.linearRampToValueAtTime(0, endAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.addEventListener('ended', () => {
    void closeAudioContext(context);
  });
  oscillator.start(startAt);
  oscillator.stop(endAt);
}

async function closeAudioContext(context: AudioContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Audio cleanup is also best-effort.
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
