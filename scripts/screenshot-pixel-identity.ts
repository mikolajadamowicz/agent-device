/**
 * Live pixel-identity measurement for `screenshot`.
 *
 * Answers one question against a real target: does a snapshot rect land on the pixel a reader of
 * the PNG would point at? The screenshot is captured through the shipped CLI and projected with
 * the shipped law (`@agent-device/capture-kit/snapshot-rect-projection`), so the evidence is about
 * the product rather than a reimplementation of it.
 *
 * It writes two crops of the same capture — one at the projected rect, one at the rect read as raw
 * image pixels. When identity holds they are the same image; when it does not, only the projected
 * crop frames the control, and the ratio in the evidence file is the factor coordinates are off by.
 *
 * This is the evidence `SCREENSHOT_CROP_TARGET_CELLS` withholds acceptance for
 * (`PENDING_PIXEL_IDENTITY_EVIDENCE`).
 *
 *   node --experimental-strip-types scripts/screenshot-pixel-identity.ts \
 *     --label General --app com.apple.Preferences --platform ios --udid <udid>
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCmd } from '@agent-device/host-kit/command';
import { decodePng, PNG } from '@agent-device/capture-kit/png';
import {
  intersectScreenshotRect,
  projectSnapshotRectToScreenshot,
  resolveScreenshotRectSpace,
  resolveSnapshotBounds,
} from '@agent-device/capture-kit/snapshot-rect-projection';
import type { Rect, SnapshotNode } from '@agent-device/kernel/snapshot';

const CLI_TIMEOUT_MS = 180_000;

type Options = {
  label: string;
  app?: string;
  platform?: string;
  udid?: string;
  session: string;
  outDir: string;
  expectIdentity: boolean;
};

type Evidence = {
  target: { platform?: string; udid?: string; app?: string };
  snapshot: { backend?: string; space: string; bounds: Rect | null; node: Rect };
  image: {
    width: number;
    height: number;
    logicalWidth?: number;
    logicalHeight?: number;
    pixelDensity?: number;
  };
  ratio: { x: number; y: number };
  projectedRect: Rect;
  identityRect: Rect;
  pixelIdentity: boolean;
};

await main(process.argv.slice(2));

async function main(argv: string[]): Promise<void> {
  const options = readOptions(argv);
  await fs.mkdir(options.outDir, { recursive: true });
  const scope = sessionScope(options);

  if (options.app) {
    await cli(['open', options.app, ...scope, '--json']);
  }

  const snapshot = await cli(['snapshot', '--json', ...scope]);
  const nodes = readNodes(snapshot);
  const node = pickLabeledNode(nodes, options.label);
  const bounds = resolveSnapshotBounds(nodes);
  const space = resolveScreenshotRectSpace(readString(snapshot, 'backend'));

  const capturePath = path.join(options.outDir, 'capture.png');
  const capture = await cli(['screenshot', capturePath, '--json', ...scope]);
  const image = { width: readNumber(capture, 'width'), height: readNumber(capture, 'height') };
  if (image.width === undefined || image.height === undefined) {
    throw new Error('screenshot --json returned no image dimensions');
  }

  const projectedRect = projectSnapshotRectToScreenshot(
    space,
    bounds,
    node,
    image.width,
    image.height,
  );
  const identityRect = roundRect(node);
  const evidence: Evidence = {
    target: { platform: options.platform, udid: options.udid, app: options.app },
    snapshot: { backend: readString(snapshot, 'backend'), space, bounds, node },
    image: {
      width: image.width,
      height: image.height,
      logicalWidth: readNumber(capture, 'logicalWidth'),
      logicalHeight: readNumber(capture, 'logicalHeight'),
      pixelDensity: readNumber(capture, 'pixelDensity'),
    },
    ratio: {
      x: bounds ? image.width / bounds.width : 1,
      y: bounds ? image.height / bounds.height : 1,
    },
    projectedRect,
    identityRect,
    pixelIdentity: rectsEqual(projectedRect, identityRect),
  };

  await writeCrop(capturePath, projectedRect, path.join(options.outDir, 'projected.png'), evidence);
  await writeCrop(capturePath, identityRect, path.join(options.outDir, 'identity.png'), evidence);
  await fs.writeFile(
    path.join(options.outDir, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );

  report(evidence, options);
  if (options.expectIdentity && !evidence.pixelIdentity) process.exitCode = 1;
}

/**
 * Crops without the daemon's PNG worker: this is a measurement tool, and a worker thread the
 * script would have to tear down buys nothing at one image per run.
 */
async function writeCrop(
  sourcePath: string,
  rect: Rect,
  outPath: string,
  evidence: Evidence,
): Promise<void> {
  const box = intersectScreenshotRect(rect, evidence.image.width, evidence.image.height);
  if (!box) {
    process.stdout.write(`skipped ${path.basename(outPath)}: rect occupies no pixel of the image\n`);
    return;
  }
  const source = decodePng(await fs.readFile(sourcePath), 'screenshot');
  const output = new PNG({ width: box.width, height: box.height });
  for (let row = 0; row < box.height; row += 1) {
    const start = ((row + box.y) * source.width + box.x) * 4;
    source.data.copy(output.data, row * output.width * 4, start, start + box.width * 4);
  }
  await fs.writeFile(outPath, PNG.sync.write(output));
}

function report(evidence: Evidence, options: Options): void {
  const lines = [
    `label:        ${options.label}`,
    `backend:      ${evidence.snapshot.backend ?? '(none)'} (${evidence.snapshot.space})`,
    `viewport:     ${formatRect(evidence.snapshot.bounds)} (snapshot units)`,
    `image:        ${evidence.image.width}x${evidence.image.height} px` +
      (evidence.image.pixelDensity === undefined
        ? ' (no density reported)'
        : ` (pixelDensity ${evidence.image.pixelDensity})`),
    `ratio:        ${evidence.ratio.x.toFixed(3)}x by ${evidence.ratio.y.toFixed(3)}y`,
    `node rect:    ${formatRect(evidence.snapshot.node)}`,
    `projected:    ${formatRect(evidence.projectedRect)}`,
    `verdict:      ${
      evidence.pixelIdentity
        ? 'pixel identity HOLDS — image coordinates equal snapshot coordinates'
        : 'pixel identity FAILS — a reader of the PNG cannot use its coordinates to interact'
    }`,
    `evidence:     ${path.join(options.outDir, 'evidence.json')}`,
    `crops:        projected.png (expected to frame the control), identity.png`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** The smallest labeled node with a usable rect: the tightest frame a human can check by eye. */
function pickLabeledNode(nodes: SnapshotNode[], label: string): Rect {
  const matches = nodes
    .filter((node) => node.label === label && isUsableRect(node.rect))
    .map((node) => node.rect as Rect)
    .sort((left, right) => left.width * left.height - right.width * right.height);
  const rect = matches[0];
  if (!rect) throw new Error(`no node with a rect carries the label ${JSON.stringify(label)}`);
  return rect;
}

async function cli(args: string[]): Promise<Record<string, unknown>> {
  const result = await runCmd(process.execPath, ['bin/agent-device.mjs', ...args], {
    allowFailure: true,
    timeoutMs: CLI_TIMEOUT_MS,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout ?? '');
  } catch {
    throw new Error(`agent-device ${args.join(' ')} produced no JSON\n${result.stderr}`);
  }
  if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.data)) {
    throw new Error(`agent-device ${args.join(' ')} failed\n${JSON.stringify(parsed, null, 2)}`);
  }
  return parsed.data;
}

function sessionScope(options: Options): string[] {
  return [
    '--session',
    options.session,
    ...(options.platform ? ['--platform', options.platform] : []),
    ...(options.udid ? ['--udid', options.udid] : []),
  ];
}

function readOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith('--')) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        flags.set(token.slice(2), 'true');
        continue;
      }
      flags.set(token.slice(2), next);
      index += 1;
    }
  }
  const label = flags.get('label');
  if (!label) {
    throw new Error(
      'usage: screenshot-pixel-identity.ts --label <accessibility label> [--app <id>] ' +
        '[--platform <p>] [--udid <id>] [--session <name>] [--out-dir <dir>] [--expect-identity]',
    );
  }
  return {
    label,
    app: flags.get('app'),
    platform: flags.get('platform'),
    udid: flags.get('udid'),
    session: flags.get('session') ?? 'pixel-identity',
    outDir: flags.get('out-dir') ?? '.tmp/pixel-identity',
    expectIdentity: flags.get('expect-identity') === 'true',
  };
}

function readNodes(data: Record<string, unknown>): SnapshotNode[] {
  const nodes = data.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('snapshot --json returned no nodes');
  }
  return nodes as SnapshotNode[];
}

function readNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' ? value : undefined;
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUsableRect(rect: Rect | undefined): rect is Rect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function rectsEqual(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function formatRect(rect: Rect | null): string {
  return rect
    ? `${rect.width}x${rect.height} at (${rect.x}, ${rect.y})`
    : '(no bounds in the tree)';
}
