import type { CrashApplicationInput } from '@agent-device/contracts/app-crash-runtime';
import { appCrashRuntimeUse } from '@agent-device/contracts/platform-runtime-operations';
import type { BoundDeviceRuntime } from '@agent-device/contracts/platform-runtime';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';
import { successText } from '@agent-device/kernel/success-text';
import type { ResolvedGenericExecution } from '../core/generic-leaf-execution.ts';
import {
  resolveBoundGenericRuntime,
  type RuntimeAdmissionBindings,
} from '../core/runtime-admission.ts';

/** `crash [app]`: the named app, or the session's app when the command names none. */
export function readRequestedCrashApp(
  positionals: readonly string[],
  sessionAppBundleId: string | undefined,
): CrashApplicationInput {
  const app = positionals[0]?.trim() || sessionAppBundleId;
  if (app) return { app };
  throw new AppError('INVALID_ARGS', 'crash requires an app', {
    hint: 'Pass the app to crash (crash <app>), or open it in this session first with open <app>.',
  });
}

/**
 * The one place `crash` reaches a device (ADR 0019). Admission inspects the exact owner's
 * `crashApplication` fact and binds once, before the dispatcher runs, so an owner that cannot
 * crash an app is refused rather than discovered mid-execution.
 */
export async function resolveBoundCrashRuntime(
  params: {
    device: DeviceInfo;
    positionals: readonly string[];
    sessionAppBundleId?: string;
  } & RuntimeAdmissionBindings,
): Promise<ResolvedGenericExecution> {
  const input = readRequestedCrashApp(params.positionals, params.sessionAppBundleId);
  return await resolveBoundGenericRuntime(
    {
      command: 'crash',
      device: params.device,
      use: appCrashRuntimeUse,
      inspectFacts: params.inspectFacts,
      platformServices: params.platformServices,
      bindDevice: params.bindDevice,
    },
    (runtime) => executeCrashApplication(runtime, input),
  );
}

/** The ONE place a bound `crashApplication` executes; the response names the app the owner crashed. */
async function executeCrashApplication(
  runtime: BoundDeviceRuntime<typeof appCrashRuntimeUse>,
  input: CrashApplicationInput,
): Promise<Record<string, unknown>> {
  const result = await runtime.operations.crashApplication(input);
  return {
    action: 'crash',
    appBundleId: result.appBundleId,
    ...successText(
      `Crashed ${result.appBundleId}; relaunch it with open ${result.appBundleId} before the next interaction`,
    ),
  };
}
