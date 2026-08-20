import { vi, type Mock } from 'vitest';

import {
  createFocusAlerts,
  type BrowserNotificationConstructor,
  type FocusAlertsDependencies,
  type NativeNotificationApi,
} from '../../src/adapters/focus-alerts';
import { DEFAULT_APP_SETTINGS } from '../../src/adapters/persistence';

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

function createAudioContext() {
  const oscillator = {
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const context = {
    currentTime: 4,
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    destination: {},
    close: vi.fn(() => Promise.resolve()),
  };

  return {
    context: context as unknown as AudioContext,
    oscillator,
    gain,
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

  it('plays a volume-scaled completion tone only when sound is enabled above zero', async () => {
    const audio = createAudioContext();
    const createContext = vi.fn(() => audio.context);
    const dependencies: FocusAlertsDependencies = {
      detectTauri: () => false,
      browserNotifications: undefined,
      createAudioContext: createContext,
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

    expect(createContext).toHaveBeenCalledOnce();
    expect(audio.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 4.01);
    expect(audio.oscillator.start).toHaveBeenCalledWith(4);
    expect(audio.oscillator.stop).toHaveBeenCalledWith(4.16);
  });

  it('contains native and sound dependency failures', async () => {
    const nativeNotifications = createNativeNotifications({
      isPermissionGranted: vi.fn(() => Promise.reject(new Error('native unavailable'))),
    });
    const createContext = vi.fn(() => {
      throw new Error('audio unavailable');
    });
    const alerts = createFocusAlerts({
      detectTauri: () => true,
      nativeNotifications: nativeNotifications.api,
      createAudioContext: createContext,
    });

    await expect(alerts.notifyCompletion(DEFAULT_APP_SETTINGS)).resolves.toBeUndefined();
    expect(createContext).toHaveBeenCalledOnce();
  });
});
