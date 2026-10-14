import { daemonPlatformServicesFixture } from '../../__tests__/support/platform-services-fixture.ts';
import { expect, test, vi } from 'vitest';

import type { CrashApplicationResult } from '@agent-device/contracts/app-crash-runtime';
import {
  localRuntimeOwner,
  narrowDeviceBinding,
  type DeviceBinding,
  type RuntimeFacts,
} from '@agent-device/contracts/platform-runtime';
import {
  appCrashRuntimeUse,
  type PlatformRuntimeOperations,
} from '@agent-device/contracts/platform-runtime-operations';
import { deviceShape } from '@agent-device/kernel/device';
import { makeSession } from '../../__tests__/support/session-factories.ts';
import type {
  BindDeviceRuntime,
  InspectDeviceRuntimeFacts,
} from '../../core/request-runtime-binding.ts';
import type { GenericPlatformExecutionParams } from '../../core/generic-leaf-execution.ts';
import { readRequestedCrashApp, resolveBoundCrashRuntime } from '../crash-runtime.ts';
import { resolveGenericRuntimeExecution } from '../generic-runtime-execution.ts';
import { expectRefusesUnavailableExactOwnerFact } from '../../__tests__/support/runtime-binding-conformance.ts';

// File-scoped ids: a `local-family` owner binding reaches the real on-disk device-claim admission,
// so a shared id risks a cross-file claim collision under parallel execution.
const androidDevice = {
  id: 'crash-runtime-android',
  name: 'Android',
  platform: 'android',
  kind: 'emulator',
  target: 'mobile',
  booted: true,
} as const;
const iosDevice = {
  id: 'crash-runtime-ios',
  name: 'iPhone',
  platform: 'apple',
  appleOs: 'ios',
  kind: 'simulator',
  target: 'mobile',
  booted: true,
} as const;
const available = Object.freeze({ available: true } as const);

function crashExecutionParams(positionals: string[]): GenericPlatformExecutionParams {
  const session = makeSession('crash-runtime', { device: androidDevice });
  return {
    session,
    sessionName: session.name,
    logPath: '/tmp/daemon.log',
    command: 'crash',
    request: { command: 'crash', positionals, token: 't', session: session.name },
    positionals,
    out: undefined,
    dispatchContext: {},
  };
}

function runtimeHarness(
  crashApplication = vi.fn(async (input: { app: string }): Promise<CrashApplicationResult> => ({
    appBundleId: input.app,
  })),
) {
  const facts: RuntimeFacts<PlatformRuntimeOperations> = {
    device: { ...deviceShape(androidDevice), providerMode: 'local' },
    operations: {
      crashApplication: available,
    } as RuntimeFacts<PlatformRuntimeOperations>['operations'],
  };
  const binding = {
    device: androidDevice,
    owner: localRuntimeOwner('android'),
    facts,
    operations: { crashApplication },
    [Symbol.asyncDispose]: async () => {},
  } satisfies DeviceBinding<PlatformRuntimeOperations>;
  const inspectFacts: InspectDeviceRuntimeFacts = vi.fn(async () => facts);
  const bindDevice = vi.fn(async (_device, use) =>
    narrowDeviceBinding(binding, use),
  ) as unknown as BindDeviceRuntime;
  return { crashApplication, inspectFacts, bindDevice };
}

test('crashes the named app, falling back to the session app only when none is named', () => {
  expect(readRequestedCrashApp(['com.example.player'], 'com.example.session')).toEqual({
    app: 'com.example.player',
  });
  expect(readRequestedCrashApp([], 'com.example.session')).toEqual({ app: 'com.example.session' });
  expect(() => readRequestedCrashApp([], undefined)).toThrow(
    expect.objectContaining({ code: 'INVALID_ARGS' }),
  );
});

test('resolves one admitted binding and reports the app the owner crashed', async () => {
  const crashApplication = vi.fn(async () => ({ appBundleId: 'com.example.player' }));
  const harness = runtimeHarness(crashApplication);

  const resolved = await resolveBoundCrashRuntime({
    platformServices: daemonPlatformServicesFixture(),
    device: androidDevice,
    positionals: ['Player'],
    inspectFacts: harness.inspectFacts,
    bindDevice: harness.bindDevice,
  });

  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(harness.bindDevice).toHaveBeenCalledWith(androidDevice, appCrashRuntimeUse);
  expect(await resolved.execute(crashExecutionParams(['Player']))).toEqual({
    action: 'crash',
    appBundleId: 'com.example.player',
    message:
      'Crashed com.example.player; relaunch it with open com.example.player before the next interaction',
  });
  expect(crashApplication).toHaveBeenCalledWith({ app: 'Player' });
});

test('the generic route crashes the session app when the request names none', async () => {
  const harness = runtimeHarness();
  const session = makeSession('crash-route', {
    device: androidDevice,
    appBundleId: 'com.example.session',
  });

  const resolved = await resolveGenericRuntimeExecution({
    req: { command: 'crash', token: 't', session: session.name, positionals: [], flags: {} },
    session,
    platformServices: daemonPlatformServicesFixture(),
    inspectFacts: harness.inspectFacts,
    bindDevice: harness.bindDevice,
  } as unknown as Parameters<typeof resolveGenericRuntimeExecution>[0]);

  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  await resolved.execute(crashExecutionParams([]));
  expect(harness.crashApplication).toHaveBeenCalledWith({ app: 'com.example.session' });
});

test('refuses a crash with no app and no session app before inspection or binding', async () => {
  const harness = runtimeHarness();
  await expect(
    resolveBoundCrashRuntime({
      platformServices: daemonPlatformServicesFixture(),
      device: androidDevice,
      positionals: [],
      inspectFacts: harness.inspectFacts,
      bindDevice: harness.bindDevice,
    }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  expect(harness.inspectFacts).not.toHaveBeenCalled();
  expect(harness.bindDevice).not.toHaveBeenCalled();
});

test('refuses an iOS target whose owner states crash unavailable, never binding', async () => {
  await expectRefusesUnavailableExactOwnerFact({
    command: 'crash',
    device: iosDevice,
    unavailable: {
      available: false,
      reason: 'unsupported-platform-leaf',
      hint: 'CRASH-HINT-SENTINEL',
    },
  });
});
