import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('./adb.ts', () => ({ runAndroidShell: vi.fn() }));
vi.mock('@agent-device/host-kit/retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-device/host-kit/retry')>();
  return { ...actual, sleep: vi.fn(async () => {}) };
});

import { sleep } from '@agent-device/host-kit/retry';
import type { ShellWord } from '@agent-device/kernel/device-shell';
import { AppError } from '@agent-device/kernel/errors';

import { runAndroidShell } from './adb.ts';
import { ANDROID_AM_CRASH_MIN_SDK, crashAndroidApp } from './app-crash.ts';
import { ANDROID_EMULATOR } from './runtime.fixtures.ts';

const mockShell = vi.mocked(runAndroidShell);
const mockSleep = vi.mocked(sleep);

const PACKAGE = 'com.example.player';
const PIDOF = `pidof ${PACKAGE} || echo agent-device-no-process`;
const NO_PROCESS = 'agent-device-no-process\n';

function answer(stdout: string, exitCode = 0, stderr = '') {
  return { stdout, stderr, exitCode };
}

function render(words: readonly ShellWord[]): string {
  return words.map((word) => (typeof word === 'object' ? word.script : String(word))).join(' ');
}

/**
 * One device, answered by command. `pidReads` are the successive `pidof` answers, the last one
 * repeating as a device holding its state would; an empty read is the shell's no-process marker.
 */
function stubDevice(options: { sdk: string; pidReads: string[][]; packages?: string[] }) {
  const pidReads = [...options.pidReads];
  mockShell.mockImplementation(async (_device, words) => {
    const command = render(words);
    if (command === 'getprop ro.build.version.sdk') return answer(`${options.sdk}\n`);
    if (command === 'pm list packages') {
      return answer((options.packages ?? []).map((name) => `package:${name}`).join('\n'));
    }
    if (command.startsWith('pidof ')) {
      const pids = pidReads.length > 1 ? pidReads.shift()! : pidReads[0]!;
      return pids.length > 0 ? answer(`${pids.join(' ')}\n`) : answer(NO_PROCESS);
    }
    if (command.startsWith('am crash ')) return answer('');
    throw new Error(`unexpected adb shell ${command}`);
  });
}

function shellCommands(): string[] {
  return mockShell.mock.calls.map(([, words]) => render(words));
}

beforeEach(() => {
  mockShell.mockReset();
  mockSleep.mockClear();
});

test('crashes the running package with am crash and returns once its process is gone', async () => {
  stubDevice({ sdk: String(ANDROID_AM_CRASH_MIN_SDK), pidReads: [['4242'], ['4242'], []] });
  const signal = new AbortController().signal;

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE }, { signal })).resolves.toEqual({
    appBundleId: PACKAGE,
  });

  expect(shellCommands()).toEqual([
    'getprop ro.build.version.sdk',
    PIDOF,
    `am crash ${PACKAGE}`,
    PIDOF,
    PIDOF,
  ]);
  expect(mockShell).toHaveBeenCalledWith(ANDROID_EMULATOR, ['am', 'crash', PACKAGE], { signal });
});

test('counts the crashed process as gone when the app is already running again under a new pid', async () => {
  stubDevice({ sdk: '34', pidReads: [['4242'], ['5151']] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).resolves.toEqual({
    appBundleId: PACKAGE,
  });
  expect(shellCommands().filter((command) => command === PIDOF)).toHaveLength(2);
});

test('resolves an app name to its installed package before crashing it', async () => {
  stubDevice({
    sdk: '34',
    pidReads: [['4242'], []],
    packages: ['com.android.chrome', PACKAGE],
  });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: 'Player' })).resolves.toEqual({
    appBundleId: PACKAGE,
  });
  expect(shellCommands()).toContain(`am crash ${PACKAGE}`);
});

test('refuses an API level below 26 before touching the app', async () => {
  stubDevice({ sdk: String(ANDROID_AM_CRASH_MIN_SDK - 1), pidReads: [['4242']] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).rejects.toMatchObject({
    code: 'UNSUPPORTED_OPERATION',
    details: {
      reason: 'android-api-level-unsupported',
      sdkInt: 25,
      minimumSdkInt: 26,
    },
  });
  expect(shellCommands()).toEqual(['getprop ro.build.version.sdk']);
});

test('refuses a device that answers with no API level rather than guessing it', async () => {
  stubDevice({ sdk: '', pidReads: [['4242']] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).rejects.toMatchObject({
    code: 'COMMAND_FAILED',
    details: { reason: 'android-api-level-unreadable' },
  });
  expect(shellCommands()).toEqual(['getprop ro.build.version.sdk']);
});

test('keeps the adb failure of the API-level read instead of calling the level unreadable', async () => {
  const adbFailure = new AppError('COMMAND_FAILED', 'adb shell getprop exited with code 1', {
    reason: 'device-offline',
  });
  mockShell.mockRejectedValue(adbFailure);

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).rejects.toBe(adbFailure);
  expect(shellCommands()).toEqual(['getprop ro.build.version.sdk']);
});

test('refuses an app with no running process instead of reporting a crash that never happened', async () => {
  stubDevice({ sdk: '34', pidReads: [[]] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).rejects.toMatchObject({
    code: 'COMMAND_FAILED',
    details: { reason: 'app-not-running', appBundleId: PACKAGE },
  });
  expect(shellCommands()).not.toContain(`am crash ${PACKAGE}`);
});

test.each([
  ['an adb client that died in silence', answer('', 1)],
  ['a shell that printed the marker after complaining', answer(NO_PROCESS, 0, 'pidof: not found')],
])('reports %s as an adb failure, not as a stopped app', async (_name, pidofAnswer) => {
  mockShell.mockImplementation(async (_device, words) =>
    words[0] === 'pidof' ? pidofAnswer : answer('34\n'),
  );

  const failure = crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE });
  await expect(failure).rejects.toMatchObject({ code: 'COMMAND_FAILED' });
  await expect(failure).rejects.not.toMatchObject({ details: { reason: 'app-not-running' } });
  expect(shellCommands()).not.toContain(`am crash ${PACKAGE}`);
});

test('fails with a typed reason when the crashed process outlives the exit budget', async () => {
  stubDevice({ sdk: '34', pidReads: [['4242']] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: PACKAGE })).rejects.toMatchObject({
    code: 'COMMAND_FAILED',
    message: expect.stringContaining('still running after 5s'),
    details: { reason: 'crash-exit-unconfirmed', appBundleId: PACKAGE, pids: ['4242'] },
  });
  expect(shellCommands()).toContain(`am crash ${PACKAGE}`);
  expect(mockSleep).toHaveBeenCalledTimes(50);
});

test('refuses the settings alias, which names an intent rather than a package', async () => {
  stubDevice({ sdk: '34', pidReads: [['4242']] });

  await expect(crashAndroidApp(ANDROID_EMULATOR, { app: 'settings' })).rejects.toMatchObject({
    code: 'INVALID_ARGS',
  });
  expect(shellCommands()).toEqual(['getprop ro.build.version.sdk']);
});
