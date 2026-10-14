import { AppError } from '@agent-device/kernel/errors';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { SETTINGS_TALKBACK_NOT_INSTALLED_REASON } from '@agent-device/contracts/settings';
import { runAndroidShell } from './adb.ts';

export type AndroidTalkBackState = 'enabled' | 'disabled';

/**
 * The TalkBack builds a target may carry, in the order a target carrying several is served. Each
 * row pairs the package `pm list packages` reports with the service class the secure setting
 * `enabled_accessibility_services` names as `<package>/<service>`.
 */
const TALKBACK_SERVICES = Object.freeze([
  // Android Accessibility Suite: Google Play devices and Google APIs emulator images ship it.
  {
    package: 'com.google.android.marvin.talkback',
    service: 'com.google.android.marvin.talkback.TalkBackService',
  },
  // Samsung's own TalkBack build on One UI.
  {
    package: 'com.samsung.android.accessibility.talkback',
    service: 'com.samsung.android.accessibility.talkback.TalkBackService',
  },
] as const);

const ENABLED_SERVICES_ROW = 'enabled_accessibility_services';
const ACCESSIBILITY_ENABLED_ROW = 'accessibility_enabled';
const ACCESSIBILITY_SERVICE_SEPARATOR = ':';
/** The substring every TalkBack package name shares, so the listing returns only candidates. */
const TALKBACK_PACKAGE_FILTER = 'talkback';
const TALKBACK_COMPONENTS: ReadonlySet<string> = new Set(
  TALKBACK_SERVICES.map((build) => `${build.package}/${build.service}`),
);

/**
 * Turns the installed TalkBack on or off through the secure settings the Accessibility settings
 * screen writes: `enabled_accessibility_services` lists the enabled services and
 * `accessibility_enabled` switches the accessibility manager on for them.
 *
 * The list is merged, never overwritten: a service some other tool enabled survives both legs,
 * in the order the target held them, and `off` lowers `accessibility_enabled` only once no
 * service is left in the list. Every TalkBack build leaves the list on both legs, so a target
 * carrying two (Samsung's beside the Play one) never ends up with two screen readers, or with one
 * still speaking after `off`. A list that already reads as requested is not rewritten, because
 * the accessibility manager rebinds every listed service on each write. The target's TalkBack is
 * resolved before either leg writes, so a target without one is refused unmutated.
 */
export async function setAndroidTalkBack(
  device: DeviceInfo,
  enabled: boolean,
): Promise<{
  talkback: AndroidTalkBackState;
  service: string;
  enabledAccessibilityServices: string[];
}> {
  const component = await resolveAndroidTalkBackComponent(device);
  const current = await readEnabledAccessibilityServices(device);
  const enabledAccessibilityServices = mergeTalkBackService(current, component, enabled);
  const unchanged =
    enabledAccessibilityServices.length === current.length &&
    enabledAccessibilityServices.every((service, index) => service === current[index]);
  if (enabledAccessibilityServices.length === 0) {
    if (!unchanged) {
      await runAndroidShell(device, ['settings', 'delete', 'secure', ENABLED_SERVICES_ROW]);
    }
    await runAndroidShell(device, ['settings', 'put', 'secure', ACCESSIBILITY_ENABLED_ROW, '0']);
  } else {
    if (!unchanged) {
      await runAndroidShell(device, [
        'settings',
        'put',
        'secure',
        ENABLED_SERVICES_ROW,
        enabledAccessibilityServices.join(ACCESSIBILITY_SERVICE_SEPARATOR),
      ]);
    }
    if (enabled) {
      await runAndroidShell(device, ['settings', 'put', 'secure', ACCESSIBILITY_ENABLED_ROW, '1']);
    }
  }
  return {
    talkback: enabled ? 'enabled' : 'disabled',
    service: component,
    enabledAccessibilityServices,
  };
}

/**
 * The list with exactly the requested TalkBack presence: every other service keeps its place, every
 * TalkBack build but the served one leaves, and the served one keeps its place when already listed
 * so a request for the state the target holds reads back as the same list.
 */
function mergeTalkBackService(
  current: readonly string[],
  component: string,
  enabled: boolean,
): string[] {
  const kept = current.filter(
    (service) => service === component || !TALKBACK_COMPONENTS.has(service),
  );
  if (!enabled) return kept.filter((service) => service !== component);
  return kept.includes(component) ? kept : [...kept, component];
}

/** The installed, enabled TalkBack build: a disabled package cannot run its service. */
async function resolveAndroidTalkBackComponent(device: DeviceInfo): Promise<string> {
  const result = await runAndroidShell(device, [
    'pm',
    'list',
    'packages',
    '-e',
    TALKBACK_PACKAGE_FILTER,
  ]);
  const installed = new Set(
    result.stdout
      .split('\n')
      .map((line) => line.replace('package:', '').trim())
      .filter(Boolean),
  );
  const build = TALKBACK_SERVICES.find((candidate) => installed.has(candidate.package));
  if (build === undefined) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'TalkBack is not installed (or is disabled) on this Android target, so nothing was changed.',
      {
        deviceId: device.id,
        reason: SETTINGS_TALKBACK_NOT_INSTALLED_REASON,
        dispatched: 'no',
        packages: TALKBACK_SERVICES.map((candidate) => candidate.package),
        hint: 'Install TalkBack (the Android Accessibility Suite from Google Play), or use a Google APIs emulator image, which ships it.',
      },
    );
  }
  return `${build.package}/${build.service}`;
}

/**
 * The services the target has enabled, each in the flattened `<package>/<class>` form. `settings
 * get` prints `null` for a row that was never written, and an emptied row reads as an empty
 * string; both mean no service is enabled.
 */
async function readEnabledAccessibilityServices(device: DeviceInfo): Promise<string[]> {
  const result = await runAndroidShell(device, ['settings', 'get', 'secure', ENABLED_SERVICES_ROW]);
  const reported = result.stdout.trim();
  if (reported === '' || reported === 'null') return [];
  return reported
    .split(ACCESSIBILITY_SERVICE_SEPARATOR)
    .map((service) => flattenAccessibilityComponent(service.trim()))
    .filter(Boolean);
}

/**
 * The row accepts the short component spelling `<package>/.Class` that `ComponentName` unflattens
 * against its package; expanding it is what lets a hand-written TalkBack entry match the table.
 */
function flattenAccessibilityComponent(component: string): string {
  const separator = component.indexOf('/');
  if (separator === -1 || component[separator + 1] !== '.') return component;
  const packageName = component.slice(0, separator);
  return `${packageName}/${packageName}${component.slice(separator + 1)}`;
}
