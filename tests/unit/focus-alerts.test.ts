import { vi, type Mock } from 'vitest';

import {
  createFocusAlerts,
  type BrowserNotificationConstructor,
  type FocusAlertsDependencies,
  type NativeNotificationApi,
} from '../../src/adapters/focus-alerts';
import { DEFAULT_APP_SETTINGS } from '../../src/adapters/persistence';
import type { GameSoundscape } from '../../src/adapters/soundscape';

function createNativeNotifications(overrides: Partial<NativeNotificationApi> = {}): {
  readonly api: NativeNotificationApi;
  readonly isPermissionGranted: Mock<NativeNotificationApi['isPermissionGranted']>;
  readonly requestPermission: Mock<NativeNotificationApi['requestPermission']>;
  readonly sendNotification: Mock<NativeNotificationApi['sendNotification']>;
} {
  const isPermissionGranted = vi.fn<NativeNotificationApi['isPermissionGranted']>(
    overrides.isPermissionGranted ?? (() => Promise.resolve(true)),
  );
  const requestPermission = vi.fn<NativeNotificationApi['requestPermission']>(
    overrides.requestPermission ?? (() => Promise.resolve('granted' as NotificationPermission)),
  );
  const sendNotification = vi.fn<NativeNotificationApi['sendNotification']>(
    overrides.sendNotification ?? (() => undefined),
  );
  return {
    api: { isPermissionGranted, requestPermission, sendNotification },
    isPermissionGranted,
    requestPermission,
    sendNotification,
  };
}

function createSoundscapeHarness(playCue: GameSoundscape['playCue'] = () => Promise.resolve()): {
  readonly playCue: Mock<GameSoundscape['playCue']>;
  readonly soundscape: GameSoundscape;
} {
  const playCueMock = vi.fn(playCue);
  return {
    playCue: playCueMock,
    soundscape: {
      playCue: playCueMock,
      stop: vi.fn(() => Promise.resolve()),
      updateAtmosphere: vi.fn(() => Promise.resolve()),
    },
  };
}

describe('focus alerts', () => {
  it('checks, requests, and sends a native notification when permission is granted', async () => {
    const nativeNotifications = createNativeNotifications({
      isPermissionGranted: vi.fn(() => Promise.resolve(false)),
    });
    const alerts = createFocusAlerts({
      detectTauri: () => true,
      nativeNotifications: nativeNotifications.api,
    });

    await alerts.notifyCompletion({ ...DEFAULT_APP_SETTINGS, soundEnabled: false });

    expect(nativeNotifications.isPermissionGranted).toHaveBeenCalledOnce();
    expect(nativeNotifications.requestPermission).toHaveBeenCalledOnce();
    expect(nativeNotifications.sendNotification).toHaveBeenCalledWith({
      title: 'Focus complete',
      body: 'Your focus session is complete.',
    });
  });

  it('does not notify natively when the permission request is denied', async () => {
    const nativeNotifications = createNativeNotifications({
      isPermissionGranted: vi.fn(() => Promise.resolve(false)),
      requestPermission: vi.fn(() => Promise.resolve('denied' as NotificationPermission)),
    });
    const alerts = createFocusAlerts({
      detectTauri: () => true,
      nativeNotifications: nativeNotifications.api,
    });

    await alerts.notifyCompletion({ ...DEFAULT_APP_SETTINGS, soundEnabled: false });

    expect(nativeNotifications.requestPermission).toHaveBeenCalledOnce();
    expect(nativeNotifications.sendNotification).not.toHaveBeenCalled();
  });

  it('does not access notification APIs when notifications are disabled', async () => {
    const nativeNotifications = createNativeNotifications();
    const browser = vi.fn() as unknown as BrowserNotificationConstructor;
    const alerts = createFocusAlerts({
      detectTauri: () => true,
      nativeNotifications: nativeNotifications.api,
      browserNotifications: browser,
    });

    await alerts.notifyCompletion({ ...DEFAULT_APP_SETTINGS, notificationsEnabled: false });

    expect(nativeNotifications.isPermissionGranted).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it('uses the browser Notification API when it is not running in Tauri', async () => {
    const browser = vi.fn() as unknown as BrowserNotificationConstructor;
    Object.assign(browser, {
      permission: 'granted',
      requestPermission: vi.fn(() => Promise.resolve('granted' as NotificationPermission)),
    });
    const nativeNotifications = createNativeNotifications();
    const alerts = createFocusAlerts({
      detectTauri: () => false,
      nativeNotifications: nativeNotifications.api,
      browserNotifications: browser,
    });

    await alerts.notifyCompletion({ ...DEFAULT_APP_SETTINGS, soundEnabled: false });

    expect(browser).toHaveBeenCalledWith('Focus complete', {
      body: 'Your focus session is complete.',
    });
    expect(nativeNotifications.isPermissionGranted).not.toHaveBeenCalled();
  });

  it('routes completion through the shared procedural soundscape only when sound is enabled', async () => {
    const soundscape = createSoundscapeHarness();
    const dependencies: FocusAlertsDependencies = {
      detectTauri: () => false,
      browserNotifications: undefined,
      soundscape: soundscape.soundscape,
    };
    const alerts = createFocusAlerts(dependencies);

    await alerts.notifyCompletion({
      ...DEFAULT_APP_SETTINGS,
      notificationsEnabled: false,
      soundEnabled: true,
      volumePercent: 50,
    });
    await alerts.notifyCompletion({
      ...DEFAULT_APP_SETTINGS,
      notificationsEnabled: false,
      soundEnabled: false,
      volumePercent: 50,
    });
    await alerts.notifyCompletion({
      ...DEFAULT_APP_SETTINGS,
      notificationsEnabled: false,
      soundEnabled: true,
      volumePercent: 0,
    });

    expect(soundscape.playCue).toHaveBeenCalledOnce();
    expect(soundscape.playCue).toHaveBeenCalledWith(
      'focus-complete',
      expect.objectContaining({ soundEnabled: true, volumePercent: 50 }),
    );
  });

  it('contains native and sound dependency failures', async () => {
    const nativeNotifications = createNativeNotifications({
      isPermissionGranted: vi.fn(() => Promise.reject(new Error('native unavailable'))),
    });
    const soundscape = createSoundscapeHarness(() =>
      Promise.reject(new Error('audio unavailable')),
    );
    const alerts = createFocusAlerts({
      detectTauri: () => true,
      nativeNotifications: nativeNotifications.api,
      soundscape: soundscape.soundscape,
    });

    await expect(alerts.notifyCompletion(DEFAULT_APP_SETTINGS)).resolves.toBeUndefined();
    expect(soundscape.playCue).toHaveBeenCalledOnce();
  });
});
