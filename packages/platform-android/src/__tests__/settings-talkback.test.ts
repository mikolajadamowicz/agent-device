import { test } from 'vitest';
import assert from 'node:assert/strict';
import { setAndroidSetting } from '../settings.ts';
import { assertRejectsAppError } from './test-utils/app-error.ts';
import { withFakeAdb, type FakeAdbScript } from './test-utils/fake-adb.ts';

const LIST_PACKAGES = 'shell pm list packages -e talkback';
const READ_SERVICES = 'shell settings get secure enabled_accessibility_services';
const PUT_SERVICES = 'shell settings put secure enabled_accessibility_services';
const DELETE_SERVICES = 'shell settings delete secure enabled_accessibility_services';
const PUT_ACCESSIBILITY = 'shell settings put secure accessibility_enabled';

const GOOGLE_TALKBACK =
  'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService';
const SAMSUNG_TALKBACK =
  'com.samsung.android.accessibility.talkback/com.samsung.android.accessibility.talkback.TalkBackService';
const OTHER_SERVICE = 'com.example.tool/com.example.tool.HelperAccessibilityService';

/**
 * A target holding the given packages and secure settings. Writes land on the same rows a later
 * read answers from, so a test can assert the state the device ends in, not only the calls made.
 */
function secureSettings(
  packages: readonly string[],
  rows: Record<string, string>,
): { script: FakeAdbScript; rows: Record<string, string> } {
  const state = { ...rows };
  const script: FakeAdbScript = (args) => {
    const flat = args.join(' ');
    if (flat === LIST_PACKAGES) return packages.map((pkg) => `package:${pkg}`).join('\n');
    if (flat === READ_SERVICES) return state.enabled_accessibility_services ?? 'null';
    if (args[1] === 'settings' && args[2] === 'put' && args[3] === 'secure') {
      state[String(args[4])] = String(args[5]);
      return '';
    }
    if (args[1] === 'settings' && args[2] === 'delete' && args[3] === 'secure') {
      delete state[String(args[4])];
      return '';
    }
    return { stderr: `unexpected args: ${flat}`, exitCode: 1 };
  };
  return { script, rows: state };
}

test('setAndroidSetting talkback on appends TalkBack to the enabled services and switches accessibility on', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback', 'com.example.app'], {
    enabled_accessibility_services: OTHER_SERVICE,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'on');
    assert.deepEqual(result, {
      talkback: 'enabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE, GOOGLE_TALKBACK],
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [
        LIST_PACKAGES,
        READ_SERVICES,
        `${PUT_SERVICES} ${OTHER_SERVICE}:${GOOGLE_TALKBACK}`,
        `${PUT_ACCESSIBILITY} 1`,
      ],
    );
    assert.deepEqual(target.rows, {
      enabled_accessibility_services: `${OTHER_SERVICE}:${GOOGLE_TALKBACK}`,
      accessibility_enabled: '1',
    });
  });
});

test('setAndroidSetting talkback on enables accessibility on a target that had no service enabled', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {});
  await withFakeAdb(target.script, async ({ device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'on');
    assert.deepEqual(result, {
      talkback: 'enabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [GOOGLE_TALKBACK],
    });
    assert.deepEqual(target.rows, {
      enabled_accessibility_services: GOOGLE_TALKBACK,
      accessibility_enabled: '1',
    });
  });
});

test('setAndroidSetting talkback on leaves an already enabled TalkBack list unwritten and in order', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {
    enabled_accessibility_services: `${GOOGLE_TALKBACK}:${OTHER_SERVICE}`,
    accessibility_enabled: '0',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'on');
    assert.deepEqual(result, {
      talkback: 'enabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [GOOGLE_TALKBACK, OTHER_SERVICE],
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES, READ_SERVICES, `${PUT_ACCESSIBILITY} 1`],
    );
    assert.equal(target.rows.enabled_accessibility_services, `${GOOGLE_TALKBACK}:${OTHER_SERVICE}`);
  });
});

test('setAndroidSetting talkback matches the short component spelling of an enabled TalkBack', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {
    enabled_accessibility_services: `com.google.android.marvin.talkback/.TalkBackService:${OTHER_SERVICE}`,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(result, {
      talkback: 'disabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE],
    });
    assert.equal(target.rows.enabled_accessibility_services, OTHER_SERVICE);
  });
});

test('setAndroidSetting talkback refuses a TalkBack that is installed but disabled', async () => {
  const target = secureSettings([], {});
  await withFakeAdb(target.script, async ({ calls, device }) => {
    await assertRejectsAppError(() => setAndroidSetting(device, 'talkback', 'on'), {
      code: 'UNSUPPORTED_OPERATION',
      reason: 'talkback_not_installed',
      dispatched: 'no',
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES],
    );
  });
});

test('setAndroidSetting talkback serves the Samsung build when it is the one installed', async () => {
  const target = secureSettings(['com.samsung.android.accessibility.talkback'], {});
  await withFakeAdb(target.script, async ({ device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'on');
    assert.deepEqual(result, {
      talkback: 'enabled',
      service: SAMSUNG_TALKBACK,
      enabledAccessibilityServices: [SAMSUNG_TALKBACK],
    });
    assert.equal(target.rows.enabled_accessibility_services, SAMSUNG_TALKBACK);
  });
});

test('setAndroidSetting talkback keeps one screen reader on a target carrying both builds', async () => {
  const packages = [
    'com.samsung.android.accessibility.talkback',
    'com.google.android.marvin.talkback',
  ];
  const on = secureSettings(packages, {
    enabled_accessibility_services: `${SAMSUNG_TALKBACK}:${OTHER_SERVICE}`,
    accessibility_enabled: '1',
  });
  await withFakeAdb(on.script, async ({ device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'on');
    assert.deepEqual(result, {
      talkback: 'enabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE, GOOGLE_TALKBACK],
    });
  });
  const off = secureSettings(packages, {
    enabled_accessibility_services: `${SAMSUNG_TALKBACK}:${OTHER_SERVICE}`,
    accessibility_enabled: '1',
  });
  await withFakeAdb(off.script, async ({ device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(result, {
      talkback: 'disabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE],
    });
    assert.deepEqual(off.rows, {
      enabled_accessibility_services: OTHER_SERVICE,
      accessibility_enabled: '1',
    });
  });
});

test('setAndroidSetting talkback refuses a target without TalkBack before writing anything', async () => {
  const target = secureSettings(['com.example.app'], {
    enabled_accessibility_services: OTHER_SERVICE,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    await assertRejectsAppError(() => setAndroidSetting(device, 'talkback', 'on'), {
      code: 'UNSUPPORTED_OPERATION',
      message: /TalkBack is not installed/,
      hint: /Android Accessibility Suite/,
      reason: 'talkback_not_installed',
      dispatched: 'no',
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES],
    );
    assert.deepEqual(target.rows, {
      enabled_accessibility_services: OTHER_SERVICE,
      accessibility_enabled: '1',
    });
  });
});

test('setAndroidSetting talkback off removes only TalkBack and leaves the other services enabled', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {
    enabled_accessibility_services: `${OTHER_SERVICE}:${GOOGLE_TALKBACK}`,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(result, {
      talkback: 'disabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE],
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES, READ_SERVICES, `${PUT_SERVICES} ${OTHER_SERVICE}`],
    );
    assert.deepEqual(target.rows, {
      enabled_accessibility_services: OTHER_SERVICE,
      accessibility_enabled: '1',
    });
  });
});

test('setAndroidSetting talkback off clears the row and switches accessibility off once no service is left', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {
    enabled_accessibility_services: GOOGLE_TALKBACK,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(result, {
      talkback: 'disabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [],
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES, READ_SERVICES, DELETE_SERVICES, `${PUT_ACCESSIBILITY} 0`],
    );
    assert.deepEqual(target.rows, { accessibility_enabled: '0' });
  });
});

test('setAndroidSetting talkback off rewrites nothing on a target where it was never enabled', async () => {
  const target = secureSettings(['com.google.android.marvin.talkback'], {
    enabled_accessibility_services: OTHER_SERVICE,
    accessibility_enabled: '1',
  });
  await withFakeAdb(target.script, async ({ calls, device }) => {
    const result = await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(result, {
      talkback: 'disabled',
      service: GOOGLE_TALKBACK,
      enabledAccessibilityServices: [OTHER_SERVICE],
    });
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES, READ_SERVICES],
    );
  });
  const empty = secureSettings(['com.google.android.marvin.talkback'], {});
  await withFakeAdb(empty.script, async ({ calls, device }) => {
    await setAndroidSetting(device, 'talkback', 'off');
    assert.deepEqual(
      calls.map((args) => args.join(' ')),
      [LIST_PACKAGES, READ_SERVICES, `${PUT_ACCESSIBILITY} 0`],
    );
    assert.deepEqual(empty.rows, { accessibility_enabled: '0' });
  });
});

test('setAndroidSetting talkback refuses a state outside on|off', async () => {
  await withFakeAdb(
    () => ({ stderr: 'adb must not be reached', exitCode: 1 }),
    async ({ calls, device }) => {
      await assertRejectsAppError(() => setAndroidSetting(device, 'talkback', 'loud'), {
        code: 'INVALID_ARGS',
        message: /Invalid setting state: loud/,
      });
      assert.deepEqual(calls, []);
    },
  );
});
