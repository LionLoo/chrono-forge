import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';

import { startProductionServer } from '../tests/e2e/static-server';
import {
  RUNTIME_PROFILE_AGGREGATE_RESIDENTS,
  RUNTIME_PROFILE_DETAILED_RESIDENTS,
  RUNTIME_PROFILE_SEED,
  assertRuntimeProfileFixtureContract,
  createRuntimeProfileWorld,
} from '../tests/support/runtime-profile-fixture';
import { serializeWorldSnapshot } from '../src/simulation/persistence';

const PROFILE_VERSION = 1;
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;
const HEAP_GROWTH_ALLOWANCE_BYTES = 64 * 1024 * 1024;
const PROCESS_TREE_LIMIT_BYTES = 1_536 * 1024 * 1024;
const PROCESS_TREE_GROWTH_ALLOWANCE_BYTES = 256 * 1024 * 1024;
const CONTROL_OBSERVATION_P95_LIMIT_MS = 250;
const FRAME_OBSERVATION_P95_LIMIT_MS = 50;
const CHECKPOINT_TRANSACTION_P95_LIMIT_MS = 2_000;
const IDLE_PROCESS_CPU_RATIO_LIMIT = 0.15;
const IDLE_SCRIPT_RATIO_LIMIT = 0.1;
// Headless Chromium's TaskDuration advances with its renderer task runner even when page script is
// quiet, so it is bounded to observed wall time while ScriptDuration and installed process CPU own
// the actual idle-churn acceptance signal.
const IDLE_TASK_RATIO_LIMIT = 1.05;
const SAVE_LIMIT_MS = 1_000;
const LOAD_LIMIT_MS = 2_000;

type ProfileTarget = 'browser' | 'installed';

interface NamedLatency {
  readonly label: string;
  readonly milliseconds: number;
}

interface ProcessTreeSample {
  readonly cpuSeconds: number;
  readonly processCount: number;
  readonly workingSetBytes: number;
}

interface RuntimeSample {
  readonly documents: number | null;
  readonly heapUsedBytes: number;
  readonly jsEventListeners: number | null;
  readonly logicalTick: number;
  readonly nodes: number | null;
  readonly phase: string;
  readonly processTree: ProcessTreeSample | null;
  readonly scriptDurationSeconds: number | null;
  readonly taskDurationSeconds: number | null;
}

interface IdleObservation {
  readonly durationSeconds: number;
  readonly processCpuSeconds: number | null;
  readonly scriptDurationSeconds: number | null;
  readonly taskDurationSeconds: number | null;
}

interface ProcessRecord {
  readonly KernelModeTime: number | string | null;
  readonly ParentProcessId: number;
  readonly ProcessId: number;
  readonly UserModeTime: number | string | null;
  readonly WorkingSetSize: number | string | null;
}

interface HeapUsage {
  readonly usedSize: number;
}

interface DomCounters {
  readonly documents: number;
  readonly jsEventListeners: number;
  readonly nodes: number;
}

interface PerformanceMetric {
  readonly name: string;
  readonly value: number;
}

interface PerformanceMetrics {
  readonly metrics: readonly PerformanceMetric[];
}

function positiveInteger(name: string, fallback: number): number {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function percentile(samples: readonly number[], percentileValue: number): number {
  if (samples.length === 0) throw new Error('Cannot calculate a percentile without samples.');
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1]!;
}

function performanceMetric(metrics: PerformanceMetrics | null, name: string): number | null {
  return metrics?.metrics.find((metric) => metric.name === name)?.value ?? null;
}

function repositoryCommit(): string {
  try {
    const repository = process.cwd().replaceAll('\\', '/');
    return execFileSync('git', ['-c', `safe.directory=${repository}`, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? 'unknown';
  }
}

function largeWorldPackage(): Readonly<{
  aggregateResidents: number;
  detailedResidents: number;
  name: string;
  savePackage: string;
  slotId: string;
  worldHeight: number;
  worldWidth: number;
}> {
  const world = createRuntimeProfileWorld();
  assertRuntimeProfileFixtureContract(world);
  const snapshot = serializeWorldSnapshot(world);
  const slotId = 'm1065-runtime-profile';
  const name = 'M10.65 large runtime profile';
  return Object.freeze({
    aggregateResidents: world.populationScale.cohorts.reduce(
      (total, cohort) => total + cohort.residentIds.length,
      0,
    ),
    detailedResidents: world.populationScale.detailedResidents.length,
    name,
    slotId,
    worldHeight: world.config.height,
    worldWidth: world.config.width,
    savePackage: JSON.stringify({
      checksum: createHash('sha256').update(snapshot).digest('hex'),
      format: 'chrono-forge-save-export',
      name,
      slotId,
      snapshot,
      version: 1,
    }),
  });
}

async function importPackage(page: Page, savePackage: string, loadedName: string): Promise<number> {
  const details = page.locator('details').filter({ hasText: 'Import or export package' });
  if ((await details.getAttribute('open')) === null) {
    await details.getByText('Import or export package').click();
  }
  await page.getByRole('textbox', { name: 'Import package' }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, savePackage);
  const startedAt = nodePerformance.now();
  await page.getByRole('button', { name: 'Validate and import' }).click();
  await page.getByText(`Loaded ${loadedName}.`).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  return nodePerformance.now() - startedAt;
}

async function installControlledClock(page: Page): Promise<void> {
  await page.evaluate((initialNow) => {
    const controlled = { now: initialNow };
    const runtime = globalThis as typeof globalThis & {
      __chronoForgeM1065Clock?: { now: number };
    };
    runtime.__chronoForgeM1065Clock = controlled;
    Date.now = () => controlled.now;
  }, Date.now());
}

async function advanceControlledClock(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((elapsedMilliseconds) => {
    const runtime = globalThis as typeof globalThis & {
      __chronoForgeM1065Clock?: { now: number };
    };
    if (runtime.__chronoForgeM1065Clock === undefined) {
      throw new Error('M10.65 controlled clock is unavailable.');
    }
    runtime.__chronoForgeM1065Clock.now += elapsedMilliseconds;
  }, milliseconds);
}

async function logicalTick(page: Page): Promise<number> {
  const text = await page
    .locator('.world-metrics div')
    .filter({ hasText: 'Logical tick' })
    .locator('dd')
    .innerText();
  const value = Number(text.replaceAll(',', '').trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid logical tick readout: ${text}`);
  }
  return value;
}

async function waitForTick(page: Page, minimumTick: number, timeoutMs = 30_000): Promise<void> {
  const startedAt = nodePerformance.now();
  while (nodePerformance.now() - startedAt < timeoutMs) {
    if ((await logicalTick(page)) >= minimumTick) return;
    await page.waitForTimeout(25);
  }
  const diagnostics = {
    alerts: await page.getByRole('alert').allInnerTexts(),
    currentTick: await logicalTick(page),
    focusOutput: await page.locator('.timer-readout').allInnerTexts(),
    persistenceStatus: await page.locator('.persistence-status').allInnerTexts(),
    simulationStatus: await page.locator('.simulation-status').allInnerTexts(),
  };
  throw new Error(
    `Logical tick did not reach ${minimumTick} within ${timeoutMs} ms: ${JSON.stringify(diagnostics)}`,
  );
}

async function waitForTextChange(
  read: () => Promise<string>,
  previous: string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = nodePerformance.now();
  while (nodePerformance.now() - startedAt < timeoutMs) {
    if ((await read()) !== previous) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Visible text did not change from ${previous} within ${timeoutMs} ms.`);
}

async function waitForCondition(
  condition: () => Promise<boolean>,
  failureMessage: string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = nodePerformance.now();
  while (nodePerformance.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(failureMessage);
}

async function measureTransition(
  label: string,
  action: () => Promise<void>,
  settled: () => Promise<void>,
): Promise<NamedLatency> {
  const startedAt = nodePerformance.now();
  await action();
  await settled();
  return Object.freeze({ label, milliseconds: nodePerformance.now() - startedAt });
}

async function measureCameraLatencies(
  page: Page,
  phase: string,
  samples: number,
): Promise<readonly NamedLatency[]> {
  const readCamera = () => page.getByLabel('Camera position').innerText();
  const map = page.locator('.world-map-canvas');
  const readRenderSequence = async () => {
    const value = Number(await map.getAttribute('data-render-sequence'));
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('The world map did not expose a completed render sequence.');
    }
    return value;
  };
  const latencies: NamedLatency[] = [];
  for (let index = 0; index < samples; index += 1) {
    const previous = await readCamera();
    const previousRenderSequence = await readRenderSequence();
    latencies.push(
      await measureTransition(
        `${phase}-camera-${index + 1}`,
        () => page.getByRole('button', { name: 'Pan world right' }).click(),
        async () => {
          await Promise.all([
            waitForTextChange(readCamera, previous),
            waitForCondition(
              async () => (await readRenderSequence()) > previousRenderSequence,
              'World map did not complete a render after the camera changed.',
            ),
          ]);
        },
      ),
    );
  }
  return Object.freeze(latencies);
}

async function animationFrameIntervals(page: Page, samples: number): Promise<readonly number[]> {
  return page.evaluate(async (sampleCount) => {
    const intervals: number[] = [];
    let previous = await new Promise<number>((resolveFrame) => requestAnimationFrame(resolveFrame));
    for (let index = 0; index < sampleCount; index += 1) {
      const now = await new Promise<number>((resolveFrame) => requestAnimationFrame(resolveFrame));
      intervals.push(now - previous);
      previous = now;
    }
    return intervals;
  }, samples);
}

function numericProcessValue(value: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function windowsProcessTree(rootProcessId: number | null): ProcessTreeSample | null {
  if (rootProcessId === null || process.platform !== 'win32') return null;
  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = JSON.parse(output) as ProcessRecord | readonly ProcessRecord[];
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    const included = new Set<number>([rootProcessId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of processes) {
        if (included.has(entry.ParentProcessId) && !included.has(entry.ProcessId)) {
          included.add(entry.ProcessId);
          changed = true;
        }
      }
    }
    const tree = processes.filter((entry) => included.has(entry.ProcessId));
    if (!tree.some((entry) => entry.ProcessId === rootProcessId)) return null;
    return Object.freeze({
      cpuSeconds:
        tree.reduce(
          (total, entry) =>
            total +
            numericProcessValue(entry.KernelModeTime) +
            numericProcessValue(entry.UserModeTime),
          0,
        ) / 10_000_000,
      processCount: tree.length,
      workingSetBytes: tree.reduce(
        (total, entry) => total + numericProcessValue(entry.WorkingSetSize),
        0,
      ),
    });
  } catch {
    return null;
  }
}

async function cdpValue<T>(session: CDPSession, method: string): Promise<T | null> {
  try {
    return (await session.send(method)) as T;
  } catch {
    return null;
  }
}

async function runtimeSample(
  page: Page,
  session: CDPSession,
  phase: string,
  rootProcessId: number | null,
): Promise<RuntimeSample> {
  await cdpValue(session, 'HeapProfiler.collectGarbage');
  const [heap, dom, performanceMetrics] = await Promise.all([
    cdpValue<HeapUsage>(session, 'Runtime.getHeapUsage'),
    cdpValue<DomCounters>(session, 'Memory.getDOMCounters'),
    cdpValue<PerformanceMetrics>(session, 'Performance.getMetrics'),
  ]);
  const fallbackHeap = await page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number };
      }
    ).memory;
    return memory?.usedJSHeapSize ?? null;
  });
  const metrics = new Map(
    performanceMetrics?.metrics.map((metric) => [metric.name, metric.value]) ?? [],
  );
  const heapUsedBytes = heap?.usedSize ?? fallbackHeap;
  if (heapUsedBytes === null) throw new Error('The target did not expose JavaScript heap usage.');
  return Object.freeze({
    documents: dom?.documents ?? null,
    heapUsedBytes,
    jsEventListeners: dom?.jsEventListeners ?? null,
    logicalTick: await logicalTick(page),
    nodes: dom?.nodes ?? null,
    phase,
    processTree: windowsProcessTree(rootProcessId),
    scriptDurationSeconds: metrics.get('ScriptDuration') ?? null,
    taskDurationSeconds: metrics.get('TaskDuration') ?? null,
  });
}

async function configureReducedEffects(page: Page): Promise<NamedLatency> {
  const summary = page.getByText('Focus and accessibility settings', { exact: true });
  const details = summary.locator('xpath=ancestor::details');
  if ((await details.getAttribute('open')) === null) await summary.click();
  const checkbox = page.getByRole('checkbox', { name: 'Reduce visual effects' });
  if (await checkbox.isChecked()) {
    return Object.freeze({ label: 'reduced-effects-already-enabled', milliseconds: 0 });
  }
  return measureTransition(
    'enable-reduced-effects',
    () => checkbox.check(),
    () =>
      page
        .locator('.world-map-canvas[data-effects="reduced"]')
        .waitFor({ state: 'visible', timeout: 5_000 }),
  );
}

async function profileRuntime(
  target: ProfileTarget,
  browser: Browser,
  context: BrowserContext,
  page: Page,
  outputFile: string,
): Promise<void> {
  const profileMinutes = positiveInteger('CHRONO_FORGE_PROFILE_MINUTES', 120);
  const stepMinutes = positiveInteger('CHRONO_FORGE_PROFILE_STEP_MINUTES', 1);
  if (profileMinutes % stepMinutes !== 0) {
    throw new RangeError('CHRONO_FORGE_PROFILE_MINUTES must divide into whole profile steps.');
  }
  const rootProcessIdSource = process.env.CHRONO_FORGE_PROCESS_ID;
  if (target === 'installed' && rootProcessIdSource === undefined) {
    throw new Error(
      'Installed profiling requires CHRONO_FORGE_PROCESS_ID so process memory and idle CPU cannot be skipped.',
    );
  }
  const rootProcessId =
    rootProcessIdSource === undefined ? null : Number.parseInt(rootProcessIdSource, 10);
  if (rootProcessId !== null && (!Number.isSafeInteger(rootProcessId) || rootProcessId <= 0)) {
    throw new RangeError('CHRONO_FORGE_PROCESS_ID must be a positive process id.');
  }

  const cdp = await context.newCDPSession(page);
  await cdpValue(cdp, 'Performance.enable');
  const browserVersion = browser.version();
  const viewport = page.viewportSize();
  const fixture = largeWorldPackage();
  if (fixture.detailedResidents !== RUNTIME_PROFILE_DETAILED_RESIDENTS) {
    throw new Error(
      `Large-world fixture retained ${fixture.detailedResidents} detailed residents instead of ${RUNTIME_PROFILE_DETAILED_RESIDENTS}.`,
    );
  }
  if (fixture.aggregateResidents !== RUNTIME_PROFILE_AGGREGATE_RESIDENTS) {
    throw new Error(
      `Large-world fixture aggregated ${fixture.aggregateResidents} residents instead of ${RUNTIME_PROFILE_AGGREGATE_RESIDENTS}.`,
    );
  }
  await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await installControlledClock(page);

  const latencies: NamedLatency[] = [];
  const samples: RuntimeSample[] = [];
  let idleObservation: IdleObservation | null = null;
  const importMs = await importPackage(page, fixture.savePackage, fixture.name);
  latencies.push({ label: 'import-large-world', milliseconds: importMs });
  samples.push(await runtimeSample(page, cdp, 'large-world-loaded', rootProcessId));

  const earlyFrames = await animationFrameIntervals(page, 120);
  latencies.push(...(await measureCameraLatencies(page, 'early-warmup', 2)));
  const earlyCamera = await measureCameraLatencies(page, 'early', 5);
  latencies.push(...earlyCamera);

  const configuredFocusMinutes = Math.min(1_440, Math.max(180, profileMinutes + 30));
  await page
    .getByRole('spinbutton', { name: 'Custom focus minutes' })
    .fill(configuredFocusMinutes.toString());
  latencies.push(
    await measureTransition(
      'start-focus',
      () => page.getByRole('button', { name: 'Start focus' }).click(),
      () => page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible' }),
    ),
  );
  const ratioText = await page.locator('.timer-ratio').innerText();
  const ratio = Number(/^([0-9,]+) simulation ticks/u.exec(ratioText)?.[1]?.replaceAll(',', ''));
  if (!Number.isSafeInteger(ratio) || ratio < 1) {
    throw new Error(`Invalid focus-to-simulation ratio: ${ratioText}`);
  }
  const normalPacingStartTick = await logicalTick(page);
  await advanceControlledClock(page, 1_000);
  await waitForTick(page, normalPacingStartTick + ratio);
  const startTick = await logicalTick(page);
  const stepLatenciesMs: number[] = [];
  const steps = profileMinutes / stepMinutes;
  const sampleSteps = new Set([
    1,
    Math.ceil(steps / 4),
    Math.ceil(steps / 2),
    Math.ceil((steps * 3) / 4),
    steps,
  ]);

  for (let step = 1; step <= steps; step += 1) {
    const expectedTick = startTick + step * stepMinutes * 60 * ratio;
    const startedAt = nodePerformance.now();
    await advanceControlledClock(page, stepMinutes * 60_000);
    const pauseLatency = await measureTransition(
      `checkpoint-pause-${step}`,
      () => page.getByRole('button', { name: 'Pause' }).click(),
      () => page.getByRole('button', { name: 'Resume' }).waitFor({ state: 'visible' }),
    );
    await waitForTick(page, expectedTick);
    stepLatenciesMs.push(nodePerformance.now() - startedAt);

    if (step === Math.ceil(steps / 2)) {
      latencies.push({ ...pauseLatency, label: 'pause-focus' });
      const pausedTick = await logicalTick(page);
      // Let the final authoritative projection and presentation interpolation settle before the
      // idle window. The observation is intended to measure a steady paused app, not pause work.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      const idleStartedAt = nodePerformance.now();
      const idleProcessStart = windowsProcessTree(rootProcessId);
      const idlePerformanceStart = await cdpValue<PerformanceMetrics>(
        cdp,
        'Performance.getMetrics',
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
      if ((await logicalTick(page)) !== pausedTick) {
        throw new Error('Paused focus advanced the logical world.');
      }
      const idlePerformanceEnd = await cdpValue<PerformanceMetrics>(cdp, 'Performance.getMetrics');
      const idleProcessEnd = windowsProcessTree(rootProcessId);
      const idleScriptStart = performanceMetric(idlePerformanceStart, 'ScriptDuration');
      const idleScriptEnd = performanceMetric(idlePerformanceEnd, 'ScriptDuration');
      const idleTaskStart = performanceMetric(idlePerformanceStart, 'TaskDuration');
      const idleTaskEnd = performanceMetric(idlePerformanceEnd, 'TaskDuration');
      idleObservation = Object.freeze({
        durationSeconds: (nodePerformance.now() - idleStartedAt) / 1_000,
        processCpuSeconds:
          idleProcessStart === null || idleProcessEnd === null
            ? null
            : idleProcessEnd.cpuSeconds - idleProcessStart.cpuSeconds,
        scriptDurationSeconds:
          idleScriptStart === null || idleScriptEnd === null
            ? null
            : idleScriptEnd - idleScriptStart,
        taskDurationSeconds:
          idleTaskStart === null || idleTaskEnd === null ? null : idleTaskEnd - idleTaskStart,
      });
      samples.push(await runtimeSample(page, cdp, 'paused-idle', rootProcessId));
      latencies.push(await configureReducedEffects(page));
      latencies.push(
        await measureTransition(
          'resume-focus',
          () => page.getByRole('button', { name: 'Resume' }).click(),
          () => page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible' }),
        ),
      );
    } else {
      await page.getByRole('button', { name: 'Resume' }).click();
      await page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible' });
    }
    if (sampleSteps.has(step)) {
      samples.push(
        await runtimeSample(page, cdp, `focus-${step * stepMinutes}-minutes`, rootProcessId),
      );
    }
  }

  const expectedFinalTick = startTick + profileMinutes * 60 * ratio;
  await waitForTick(page, expectedFinalTick);
  latencies.push(
    await measureTransition(
      'complete-controlled-focus',
      () => page.getByRole('button', { name: 'Complete focus' }).click(),
      () =>
        page
          .getByText(/Session recorded with (?:a factual recap|an honest quiet interval)\./u)
          .waitFor({ state: 'visible', timeout: 30_000 }),
    ),
  );
  const completedTick = await logicalTick(page);
  samples.push(await runtimeSample(page, cdp, 'focus-completed', rootProcessId));

  latencies.push(
    await measureTransition(
      'save-large-world',
      () => page.getByRole('button', { name: 'Save now' }).click(),
      () => page.getByText('World saved manually.').waitFor({ state: 'visible', timeout: 30_000 }),
    ),
  );
  const slotSelector = page.getByRole('combobox', { name: 'Load local slot' });
  await slotSelector.selectOption('primary');
  await page.getByText('Loaded Founding world.').waitFor({ state: 'visible', timeout: 30_000 });
  latencies.push(
    await measureTransition(
      'reload-large-world',
      () => slotSelector.selectOption(fixture.slotId),
      () =>
        page.getByText(`Loaded ${fixture.name}.`).waitFor({ state: 'visible', timeout: 30_000 }),
    ),
  );
  if ((await logicalTick(page)) !== completedTick) {
    throw new Error('Large-world save/reload changed the authoritative logical tick.');
  }
  samples.push(await runtimeSample(page, cdp, 'save-reloaded', rootProcessId));

  latencies.push(...(await measureCameraLatencies(page, 'late-warmup', 2)));
  const lateCamera = await measureCameraLatencies(page, 'late', 5);
  latencies.push(...lateCamera);
  const lateFrames = await animationFrameIntervals(page, 120);
  samples.push(await runtimeSample(page, cdp, 'late-interaction', rootProcessId));
  await cdp.detach();
  if (target === 'installed') {
    await browser.close();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  } else {
    await page.waitForTimeout(5_000);
  }
  const settledProcessTree = windowsProcessTree(rootProcessId);
  const earlyCameraP95 = percentile(
    earlyCamera.map((sample) => sample.milliseconds),
    95,
  );
  const lateCameraP95 = percentile(
    lateCamera.map((sample) => sample.milliseconds),
    95,
  );
  const peakHeapBytes = Math.max(...samples.map((sample) => sample.heapUsedBytes));
  const warmedHeapBytes = samples[0]!.heapUsedBytes;
  const finalHeapBytes = samples.at(-1)!.heapUsedBytes;
  const processSamples = samples.flatMap((sample) =>
    sample.processTree === null ? [] : [sample.processTree],
  );
  const peakProcessTreeBytes =
    processSamples.length === 0
      ? null
      : Math.max(...processSamples.map((sample) => sample.workingSetBytes));
  // WebView/GPU processes allocate lazily on the first active focus projection. Start the growth
  // slope after that warm-up rather than charging one-time renderer initialization as a leak.
  const warmedProcessTreeBytes =
    samples.find((sample) => sample.phase === `focus-${stepMinutes}-minutes`)?.processTree
      ?.workingSetBytes ??
    processSamples[0]?.workingSetBytes ??
    null;
  const finalProcessTreeBytes =
    settledProcessTree?.workingSetBytes ?? processSamples.at(-1)?.workingSetBytes ?? null;
  const violations: string[] = [];
  if (
    target === 'installed' &&
    (processSamples.length !== samples.length || settledProcessTree === null)
  ) {
    violations.push(
      'Installed process-tree telemetry was unavailable for one or more samples; memory and idle acceptance must fail closed.',
    );
  }
  if (peakHeapBytes >= HEAP_LIMIT_BYTES) {
    violations.push(`Peak JavaScript heap ${peakHeapBytes} exceeded ${HEAP_LIMIT_BYTES}.`);
  }
  if (finalHeapBytes > warmedHeapBytes + HEAP_GROWTH_ALLOWANCE_BYTES) {
    violations.push(
      `Final collected heap grew by ${finalHeapBytes - warmedHeapBytes} bytes; allowance is ${HEAP_GROWTH_ALLOWANCE_BYTES}.`,
    );
  }
  if (peakProcessTreeBytes !== null && peakProcessTreeBytes >= PROCESS_TREE_LIMIT_BYTES) {
    violations.push(
      `Peak installed process tree ${peakProcessTreeBytes} bytes exceeded ${PROCESS_TREE_LIMIT_BYTES}.`,
    );
  }
  if (
    warmedProcessTreeBytes !== null &&
    finalProcessTreeBytes !== null &&
    finalProcessTreeBytes > warmedProcessTreeBytes + PROCESS_TREE_GROWTH_ALLOWANCE_BYTES
  ) {
    violations.push(
      `Final installed process tree grew by ${finalProcessTreeBytes - warmedProcessTreeBytes} bytes; allowance is ${PROCESS_TREE_GROWTH_ALLOWANCE_BYTES}.`,
    );
  }
  if (
    earlyCameraP95 >= CONTROL_OBSERVATION_P95_LIMIT_MS ||
    lateCameraP95 >= CONTROL_OBSERVATION_P95_LIMIT_MS
  ) {
    violations.push(
      `Camera-control observation p95 was ${earlyCameraP95.toFixed(2)} ms early and ${lateCameraP95.toFixed(2)} ms late; limit is ${CONTROL_OBSERVATION_P95_LIMIT_MS} ms.`,
    );
  }
  if (lateCameraP95 > earlyCameraP95 * 1.25 && lateCameraP95 >= CONTROL_OBSERVATION_P95_LIMIT_MS) {
    violations.push('Late camera p95 regressed by more than 25% and broke its absolute limit.');
  }
  const earlyFrameP95 = percentile(earlyFrames, 95);
  const lateFrameP95 = percentile(lateFrames, 95);
  if (
    earlyFrameP95 >= FRAME_OBSERVATION_P95_LIMIT_MS ||
    lateFrameP95 >= FRAME_OBSERVATION_P95_LIMIT_MS
  ) {
    violations.push(
      `Generic browser-frame observation p95 was ${earlyFrameP95.toFixed(2)} ms early and ${lateFrameP95.toFixed(2)} ms late; limit is ${FRAME_OBSERVATION_P95_LIMIT_MS} ms.`,
    );
  }
  const checkpointTransactionP95 = percentile(stepLatenciesMs, 95);
  if (checkpointTransactionP95 >= CHECKPOINT_TRANSACTION_P95_LIMIT_MS) {
    violations.push(
      `Controlled one-minute checkpoint transaction p95 ${checkpointTransactionP95.toFixed(2)} ms exceeded ${CHECKPOINT_TRANSACTION_P95_LIMIT_MS} ms.`,
    );
  }
  if (idleObservation === null) {
    violations.push('Paused-idle observation was not recorded.');
  } else {
    const idleRatios = [
      {
        label: 'script',
        limit: IDLE_SCRIPT_RATIO_LIMIT,
        value: idleObservation.scriptDurationSeconds,
      },
      {
        label: 'task',
        limit: IDLE_TASK_RATIO_LIMIT,
        value: idleObservation.taskDurationSeconds,
      },
    ] as const;
    for (const idle of idleRatios) {
      if (idle.value === null || idle.value < 0) {
        violations.push(`Paused-idle ${idle.label} telemetry was unavailable.`);
      } else if (idle.value / idleObservation.durationSeconds >= idle.limit) {
        violations.push(
          `Paused-idle ${idle.label} ratio ${(idle.value / idleObservation.durationSeconds).toFixed(4)} exceeded ${idle.limit}.`,
        );
      }
    }
    if (target === 'installed') {
      if (idleObservation.processCpuSeconds === null || idleObservation.processCpuSeconds < 0) {
        violations.push('Paused-idle installed process CPU telemetry was unavailable.');
      } else if (
        idleObservation.processCpuSeconds / idleObservation.durationSeconds >=
        IDLE_PROCESS_CPU_RATIO_LIMIT
      ) {
        violations.push(
          `Paused-idle process CPU ratio ${(idleObservation.processCpuSeconds / idleObservation.durationSeconds).toFixed(4)} exceeded ${IDLE_PROCESS_CPU_RATIO_LIMIT}.`,
        );
      }
    }
  }
  const saveLatency = latencies.find((sample) => sample.label === 'save-large-world')!;
  const loadLatency = latencies.find((sample) => sample.label === 'reload-large-world')!;
  if (saveLatency.milliseconds >= SAVE_LIMIT_MS) {
    violations.push(
      `Large-world save ${saveLatency.milliseconds.toFixed(2)} ms exceeded ${SAVE_LIMIT_MS} ms.`,
    );
  }
  if (loadLatency.milliseconds >= LOAD_LIMIT_MS) {
    violations.push(
      `Large-world reload ${loadLatency.milliseconds.toFixed(2)} ms exceeded ${LOAD_LIMIT_MS} ms.`,
    );
  }

  const report = Object.freeze({
    profileVersion: PROFILE_VERSION,
    target,
    commit: repositoryCommit(),
    generatedAt: new Date().toISOString(),
    node: process.version,
    browserVersion,
    viewport,
    fixture: {
      seed: RUNTIME_PROFILE_SEED,
      detailedResidents: fixture.detailedResidents,
      aggregateResidents: fixture.aggregateResidents,
      worldHeight: fixture.worldHeight,
      worldWidth: fixture.worldWidth,
      profileMinutes,
      stepMinutes,
      focusToSimulationRatio: ratio,
      startTick,
      completedTick,
    },
    budgets: {
      cameraControlObservationP95Ms: CONTROL_OBSERVATION_P95_LIMIT_MS,
      browserFrameObservationP95Ms: FRAME_OBSERVATION_P95_LIMIT_MS,
      checkpointTransactionP95Ms: CHECKPOINT_TRANSACTION_P95_LIMIT_MS,
      heapGrowthAllowanceBytes: HEAP_GROWTH_ALLOWANCE_BYTES,
      heapLimitBytes: HEAP_LIMIT_BYTES,
      idleProcessCpuRatio: IDLE_PROCESS_CPU_RATIO_LIMIT,
      idleScriptRatio: IDLE_SCRIPT_RATIO_LIMIT,
      idleTaskRatio: IDLE_TASK_RATIO_LIMIT,
      processTreeGrowthAllowanceBytes: PROCESS_TREE_GROWTH_ALLOWANCE_BYTES,
      processTreeLimitBytes: PROCESS_TREE_LIMIT_BYTES,
      loadMs: LOAD_LIMIT_MS,
      saveMs: SAVE_LIMIT_MS,
    },
    measurements: {
      earlyCameraControlObservationP95Ms: earlyCameraP95,
      lateCameraControlObservationP95Ms: lateCameraP95,
      earlyBrowserFrameObservationP95Ms: earlyFrameP95,
      lateBrowserFrameObservationP95Ms: lateFrameP95,
      checkpointTransactionP95Ms: checkpointTransactionP95,
      peakHeapBytes,
      warmedHeapBytes,
      finalHeapBytes,
      peakProcessTreeBytes,
      warmedProcessTreeBytes,
      finalProcessTreeBytes,
      idleObservation,
      settledProcessTree,
      latencies,
      runtimeSamples: samples,
    },
    passed: violations.length === 0,
    violations,
  });
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (violations.length > 0) {
    throw new Error(`Runtime profile failed:\n- ${violations.join('\n- ')}`);
  }
  console.log(`Runtime profile passed and wrote ${outputFile}.`);
}

const target: ProfileTarget = process.argv.includes('--installed') ? 'installed' : 'browser';
const outputDirectory = resolve(
  process.env.CHRONO_FORGE_PROFILE_OUTPUT ?? `test-results/m10-65-${target}-profile`,
);
mkdirSync(outputDirectory, { recursive: true });
const outputFile = resolve(outputDirectory, 'runtime-profile.json');
let server: Awaited<ReturnType<typeof startProductionServer>> | null = null;
let browser: Browser | null = null;

try {
  if (target === 'browser') {
    server = await startProductionServer();
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-precise-memory-info'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(server.origin);
    await profileRuntime(target, browser, context, page, outputFile);
  } else {
    const endpoint = process.env.CHRONO_FORGE_CDP_URL ?? 'http://127.0.0.1:9333';
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context
      ?.pages()
      .find((candidate) => candidate.url().startsWith('http://tauri.localhost'));
    if (context === undefined || page === undefined) {
      throw new Error('No installed Chrono Forge WebView page was exposed over CDP.');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await profileRuntime(target, browser, context, page, outputFile);
  }
} finally {
  if (browser?.isConnected()) await browser.close();
  await server?.close();
}
