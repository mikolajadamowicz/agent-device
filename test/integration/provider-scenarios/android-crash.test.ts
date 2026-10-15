import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { DeviceInfo } from '@agent-device/kernel/device';
import type { AndroidAdbProvider } from '@agent-device/platform-android/mechanics';
import { assertCommandCall } from './assertions.ts';
import { createProviderScenarioHarness, withProviderScenarioResource } from './harness.ts';
import { runProviderScenario } from './scenario.ts';

const PROVIDER_SCENARIO_ANDROID_EMULATOR: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5560',
  name: 'Android',
  kind: 'emulator',
  target: 'mobile',
  booted: true,
};
const PACKAGE = 'com.example.player';
const PIDOF = ['shell', 'pidof', PACKAGE, '|| echo agent-device-no-process'];
const AM_CRASH = ['shell', 'am', 'crash', PACKAGE];

/** An emulator on `sdk` whose app runs as pid 4242 until the first read after the crash. */
function crashingEmulator(sdk: string) {
  const calls: string[][] = [];
  let crashed = false;
  const provider: AndroidAdbProvider = {
    exec: async (args) => {
      calls.push([...args]);
      const answer = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 });
      if (args.join(' ') === 'shell getprop ro.build.version.sdk') return answer(`${sdk}\n`);
      if (args.join(' ') === AM_CRASH.join(' ')) crashed = true;
      if (args.join(' ') === PIDOF.join(' ')) {
        return answer(crashed ? 'agent-device-no-process\n' : '4242\n');
      }
      return answer('');
    },
  };
  return { calls, provider };
}

test('Provider-backed integration Android crash sends am crash to the session app and waits for its exit', async () => {
  const emulator = crashingEmulator('34');

  await withProviderScenarioResource(
    async () =>
      await createProviderScenarioHarness({
        androidAdbProvider: () => emulator.provider,
        deviceInventoryProvider: async () => [PROVIDER_SCENARIO_ANDROID_EMULATOR],
      }),
    async (daemon) => {
      daemon.publishSession('default', {
        name: 'default',
        device: PROVIDER_SCENARIO_ANDROID_EMULATOR,
        appBundleId: PACKAGE,
        createdAt: Date.now(),
        actions: [],
      });

      await runProviderScenario(daemon, [
        {
          name: 'crash the session app',
          command: 'crash',
          flags: { platform: 'android' },
          expectData: { action: 'crash', appBundleId: PACKAGE },
        },
      ]);

      assertCommandCall(emulator.calls, AM_CRASH);
      const crashAt = emulator.calls.findIndex((call) => call.join(' ') === AM_CRASH.join(' '));
      assert.ok(
        emulator.calls.slice(crashAt + 1).some((call) => call.join(' ') === PIDOF.join(' ')),
        'crash returned without reading the crashed process back',
      );
      assert.deepEqual(
        daemon.session('default')?.actions.map((action) => action.command),
        ['crash'],
      );
    },
  );
});
