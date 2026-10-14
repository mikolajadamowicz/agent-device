import type {
  CrashApplicationInput,
  CrashApplicationResult,
} from '@agent-device/contracts/app-crash-runtime';
import { sleep } from '@agent-device/host-kit/retry';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { shellFragment } from '@agent-device/kernel/device-shell';
import { AppError } from '@agent-device/kernel/errors';

import { runAndroidShell } from './adb.ts';
import { androidAdbResultError } from './adb-failure.ts';
import { resolveAndroidApp } from './app-deployment-resolution.ts';

/**
 * `am crash` is `ActivityManagerShellCommand.runCrash`, first shipped in Android 8.0 (API 26);
 * the Android 7.x `am` has no such subcommand. Nothing else on an older build raises an app crash,
 * and `am force-stop` or `am kill` would end the process without one, so older builds are refused.
 */
export const ANDROID_AM_CRASH_MIN_SDK = 26;
/**
 * `am crash` only schedules the crash on the app's main thread, so the crashed process is read
 * until it is gone; `attempts × poll` is that budget.
 */
const CRASH_EXIT_ATTEMPTS = 50;
const CRASH_EXIT_POLL_MS = 100;
const NO_PROCESS_ANSWER = 'agent-device-no-process';

const API_LEVEL_UNSUPPORTED_HINT = `crash needs Android 8.0 (API ${ANDROID_AM_CRASH_MIN_SDK}) or newer, where am crash exists; use an emulator or device on API ${ANDROID_AM_CRASH_MIN_SDK}+.`;
const API_LEVEL_UNREADABLE_HINT =
  'adb shell getprop ro.build.version.sdk answered with no API level; check the device with adb shell getprop ro.build.version.sdk, then retry.';
const NOT_RUNNING_HINT =
  'am crash only crashes a running process. Launch the app with open <app>, then retry crash.';
const EXIT_UNCONFIRMED_HINT =
  'A crash dialog keeps the crashed process alive until it is dismissed, and an app whose main thread is blocked never handles the crash. Take a screenshot to see which, then dismiss the dialog or relaunch the app with open <app> --relaunch.';

/**
 * Crashes the app's running process with `am crash <package>`, which makes the activity manager
 * deliver a crash the app's own uncaught-exception path handles, as a real crash would, and returns
 * once that process is gone.
 */
export async function crashAndroidApp(
  device: DeviceInfo,
  input: CrashApplicationInput,
  options: { signal?: AbortSignal } = {},
): Promise<CrashApplicationResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  await requireAmCrash(device, signal);
  const appBundleId = await resolveCrashPackage(device, input.app);
  // `am crash` exits 0 when no process matches the package, so a stopped app would be reported as
  // crashed with nothing crashed.
  const pids = await readPackagePids(device, appBundleId, signal);
  if (pids.length === 0) {
    throw new AppError('COMMAND_FAILED', `${appBundleId} has no running process to crash`, {
      reason: 'app-not-running',
      appBundleId,
      hint: NOT_RUNNING_HINT,
    });
  }
  await runAndroidShell(device, ['am', 'crash', appBundleId], { signal });
  await awaitCrashedProcessExit(device, appBundleId, pids, signal);
  return { appBundleId };
}

async function requireAmCrash(device: DeviceInfo, signal: AbortSignal | undefined): Promise<void> {
  // No `allowFailure`: an adb failure keeps its own classification instead of reading as no level.
  const result = await runAndroidShell(device, ['getprop', 'ro.build.version.sdk'], { signal });
  const sdkInt = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(sdkInt) || sdkInt <= 0) {
    throw new AppError('COMMAND_FAILED', 'Could not read the Android API level for crash', {
      reason: 'android-api-level-unreadable',
      deviceId: device.id,
      hint: API_LEVEL_UNREADABLE_HINT,
    });
  }
  if (sdkInt < ANDROID_AM_CRASH_MIN_SDK) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `crash requires Android API ${ANDROID_AM_CRASH_MIN_SDK} or newer; this device runs API ${sdkInt}`,
      {
        reason: 'android-api-level-unsupported',
        deviceId: device.id,
        sdkInt,
        minimumSdkInt: ANDROID_AM_CRASH_MIN_SDK,
        hint: API_LEVEL_UNSUPPORTED_HINT,
      },
    );
  }
}

async function resolveCrashPackage(device: DeviceInfo, app: string): Promise<string> {
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    throw new AppError('INVALID_ARGS', 'crash requires a package name, not an intent', {
      hint: 'Run agent-device apps --platform android to find the package name, then retry crash with it.',
    });
  }
  return resolved.value;
}

/**
 * The package's process ids. "No process" is claimed only from the marker the device shell prints,
 * never from silence: an adb client that was killed or lost the connection prints nothing at all.
 */
async function readPackagePids(
  device: DeviceInfo,
  appBundleId: string,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  const result = await runAndroidShell(
    device,
    ['pidof', appBundleId, shellFragment(`|| echo ${NO_PROCESS_ANSWER}`)],
    { allowFailure: true, signal },
  );
  const stdout = result.stdout.trim();
  const pids = stdout.split(/\s+/).filter((token) => /^\d+$/.test(token));
  if (pids.length > 0) return pids;
  if (stdout === NO_PROCESS_ANSWER && result.stderr.trim().length === 0) return [];
  throw androidAdbResultError(`adb shell pidof ${appBundleId} gave no answer`, result, {
    deviceId: device.id,
  });
}

/** Done once none of the crashed pids is running; a relaunched process has a new pid. */
async function awaitCrashedProcessExit(
  device: DeviceInfo,
  appBundleId: string,
  crashedPids: readonly string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < CRASH_EXIT_ATTEMPTS; attempt += 1) {
    await sleep(CRASH_EXIT_POLL_MS, signal);
    const running = await readPackagePids(device, appBundleId, signal);
    if (!crashedPids.some((pid) => running.includes(pid))) return;
  }
  throw new AppError(
    'COMMAND_FAILED',
    `am crash was sent, but ${appBundleId} (pid ${crashedPids.join(', ')}) was still running after ${(CRASH_EXIT_ATTEMPTS * CRASH_EXIT_POLL_MS) / 1000}s`,
    {
      reason: 'crash-exit-unconfirmed',
      appBundleId,
      pids: [...crashedPids],
      hint: EXIT_UNCONFIRMED_HINT,
    },
  );
}
