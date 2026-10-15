/**
 * Which app to crash: the name, package, or bundle id the caller passed, or the session's app when
 * the caller named none. The owner resolves it to the one installed identifier it crashes.
 */
export type CrashApplicationInput = Readonly<{ app: string }>;

/**
 * The owner's own closed result: the resolved identifier of the app whose running process it
 * crashed. An owner that could not crash a running process throws instead of answering.
 */
export type CrashApplicationResult = Readonly<{ appBundleId: string }>;

export type AppCrashRuntimeOperations = Readonly<{
  crashApplication(input: CrashApplicationInput): Promise<CrashApplicationResult>;
}>;

/** `crash` — `{ action: 'crash', appBundleId, message }`: the app whose running process crashed. */
export type CrashCommandResult = {
  action: 'crash';
  appBundleId: string;
  message: string;
};
