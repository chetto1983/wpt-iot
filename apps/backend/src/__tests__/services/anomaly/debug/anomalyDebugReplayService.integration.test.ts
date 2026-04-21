// Phase 42 Plan 42-05 Task 2 -- D-25 integration test against REAL Docker PG.
// Per .claude/skills/wpt-testing-quality/SKILL.md no-mocked-DB rule.
// Seeds machine_snapshots at boundary counts {499, 500, 501, 1001} to catch
// FETCH-500 off-by-ones. Seeds 10,000 rows + aborts at row ~500 to assert the
// BEGIN -> DECLARE -> FETCH x N -> CLOSE -> ROLLBACK ordering via a
// pool.connect() spy (D-25 literal, Pattern A: hook BEFORE drizzle(pool)).
// Also asserts the WS frame sequence progress x N -> chunk x M -> end with
// monotonic seq.
//
// Per-file beforeAll / beforeEach -- NO cross-file session fixture sharing
// (Platformatic 2025 guidance, D-26).

import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { PoolClient, QueryConfig, QueryResult } from 'pg';
import WebSocket from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import websocket from '@fastify/websocket';

import { db, pool } from '../../../../db/index.js';
import { DrizzleSessionStore } from '../../../../auth/sessionStore.js';
import { wsRoute } from '../../../../ws/route.js';
import { initBroadcaster, shutdownBroadcaster } from '../../../../ws/broadcaster.js';
import { AnomalyDebugReplayService } from '../../../../services/anomaly/debug/anomalyDebugReplayService.js';
import { createSuperAdminUser } from '../../../fixtures/testUsers.js';
import { createSessionForUser } from '../../../fixtures/testSessions.js';

// Phase 42 distinct window -- does NOT collide with the sync sibling's
// 2099-04-09T* window (machineAnomalyReplayService.integration.test.ts).
const WINDOW_FROM = new Date('2099-04-10T08:00:00.000Z');
const WINDOW_TO = new Date('2099-04-10T11:00:00.000Z');

const TEST_SESSION_SECRET = 'test-secret-32-chars-minimum-here!';

/**
 * Sign a raw sessionId with the test secret so @fastify/session accepts the
 * cookie on WS upgrade. Mirrors wsBroadcaster.test.ts / authHooks.test.ts.
 */
function makeSignedCookie(rawSessionId: string): string {
  const sig = createHmac('sha256', TEST_SESSION_SECRET)
    .update(rawSessionId)
    .digest('base64')
    .replace(/=/g, '');
  return `sessionId=${rawSessionId}.${sig}`;
}

// ----- D-25 pool.connect() SQL-sequence spy ---------------------------------
// Pattern A: hook BEFORE any drizzle(pool) use. Because `db` = drizzle(pool) is
// already created at module import, but drizzle lazily leases clients via
// pool.connect() on every transaction/query. We spy on the shared `pool`
// singleton here -- every future client handed out has its `.query()` wrapped
// to push raw SQL text into queryLog.
const queryLog: string[] = [];

// Idempotent wrap marker -- pg-pool reuses PoolClient objects across leases,
// so without this marker each subsequent connect() would add another layer of
// wrapping and duplicate every captured query proportional to the lease count.
const WRAPPED_MARKER = Symbol.for('wpt.D-25.queryLog.wrapped');

function wrapClient(client: PoolClient): PoolClient {
  if ((client as unknown as Record<symbol, boolean>)[WRAPPED_MARKER]) return client;
  const origQuery = client.query.bind(client);
  const wrapped = ((text: string | QueryConfig, ...rest: unknown[]) => {
    const sqlText = typeof text === 'string' ? text : text.text;
    queryLog.push(sqlText);
    return (origQuery as unknown as (t: unknown, ...r: unknown[]) => Promise<QueryResult>)(
      text,
      ...rest,
    );
  }) as unknown as typeof client.query;
  client.query = wrapped;
  (client as unknown as Record<symbol, boolean>)[WRAPPED_MARKER] = true;
  return client;
}

function installPoolQuerySpy(): void {
  // pg Pool.connect() has TWO call forms:
  //   1. Promise:  const client = await pool.connect();
  //   2. Callback: pool.connect((err, client, done) => { ... });
  // pg-pool's own Pool.query() internally uses the callback form -- so our
  // spy MUST honor both to avoid breaking direct pool.query() users
  // (@fastify/session, DrizzleSessionStore, any bare db.execute that doesn't
  // open a transaction).
  const origConnect = pool.connect.bind(pool);
  vi.spyOn(pool, 'connect').mockImplementation(((...args: unknown[]) => {
    // Callback form: first arg is a function -- intercept the callback so we
    // wrap the client before pg-pool hands it back.
    if (typeof args[0] === 'function') {
      const userCb = args[0] as (err: Error | undefined, client: PoolClient, done: () => void) => void;
      return (origConnect as unknown as (cb: typeof userCb) => void)(
        (err, client, done) => {
          if (err) {
            userCb(err, client, done);
            return;
          }
          userCb(err, wrapClient(client), done);
        },
      );
    }
    // Promise form: no args -- await then wrap.
    return (origConnect as unknown as () => Promise<PoolClient>)().then(wrapClient);
  }) as unknown as typeof pool.connect);
}

function cursorStatementsOnly(): string[] {
  // Filter queryLog to cursor-lifecycle statements only. Matches the leading
  // keyword of the statement so we ignore the inner SELECT body of DECLARE.
  return queryLog.filter((q) =>
    /^\s*(BEGIN|DECLARE\s+replay_cursor|FETCH\s+FORWARD|CLOSE\s+replay_cursor|COMMIT|ROLLBACK)\b/i.test(
      q,
    ),
  );
}

// ----- DB helpers -----------------------------------------------------------

async function clearWindow(): Promise<void> {
  await db.execute(sql`
    DELETE FROM machine_snapshots
    WHERE timestamp >= ${WINDOW_FROM.toISOString()}::timestamptz
      AND timestamp <  ${WINDOW_TO.toISOString()}::timestamptz
  `);
}

/**
 * Seed N rows spaced 1s apart inside the window. Uses a bulk multi-VALUES
 * INSERT in batches of 500 to keep the 10k-row seed wall-time bounded (< 10s
 * on the Docker PG). Every row carries the same stable values -- the test
 * doesn't care about anomaly content, only cursor / frame sequencing.
 */
async function seedRows(count: number): Promise<void> {
  const BATCH = 500;
  for (let start = 0; start < count; start += BATCH) {
    const end = Math.min(start + BATCH, count);
    // Build a VALUES list for this batch.
    const values: string[] = [];
    for (let i = start; i < end; i++) {
      const ts = new Date(WINDOW_FROM.getTime() + i * 1_000).toISOString();
      values.push(
        `('${ts}'::timestamptz, 1, 1, 0, 20, 1, 1500, 10, 1, 1500, 5, 10, 10, 10, 100, 100, 1500, 0, 20, 20, 20, 20, 20, 20, 80, 5, 400, 400, 400, 230, 230, 230, 95, 25, 25, 25, 25)`,
      );
    }
    await db.execute(sql.raw(`
      INSERT INTO machine_snapshots (
        timestamp, selected_cycle, current_phase, machine_status,
        garbage_temp, chamber_pressure, main_motor_speed, main_motor_current, main_motor_torque,
        vacuum_pump_speed_01, energy_consumption, rms_curr_l1, rms_curr_l2, rms_curr_l3,
        material_input_weight, material_output_weight, vacuum_pump_speed_02, rms_curr_n,
        thermo_left_lower, thermo_left_medium, thermo_left_upper,
        thermo_right_lower, thermo_right_medium, thermo_right_upper,
        holding_temp_setpoint, water_consumption,
        line_volt_l1_l2, line_volt_l2_l3, line_volt_l3_l1,
        line_neutral_volt_l1, line_neutral_volt_l2, line_neutral_volt_l3,
        pf_total,
        thermo_left_high_lower, thermo_left_high_medium, thermo_left_high_upper, thermo_right_high_lower
      ) VALUES ${values.join(',')}
    `));
  }
}

// ----- Test harness ---------------------------------------------------------

async function buildWsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: TEST_SESSION_SECRET,
    store: new DrizzleSessionStore(),
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 86_400_000,
      path: '/',
    },
    saveUninitialized: false,
  });
  await app.register(websocket);
  app.register(wsRoute, { prefix: '/api' });
  await app.ready();
  return app;
}

/**
 * Queue-backed WS test client. Mirrors `wsBroadcaster.test.ts` openWsClient:
 * attaches a permanent 'message' listener BEFORE 'open' fires so no
 * server-pushed frame (initial MACHINE_DATA / ALARM_UPDATE / PLC_STATUS or
 * any in-flight REPLAY_FRAME) is ever lost to the listener-registration
 * race that bites `ws.once('message', ...)` per call.
 */
interface IWsTestClient {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

async function openWs(serverAddr: string, signedCookie: string): Promise<IWsTestClient> {
  const url = serverAddr.replace('http', 'ws') + '/api/ws';
  const ws = new WebSocket(url, { headers: { Cookie: signedCookie } });

  const queue: Record<string, unknown>[] = [];
  const waiting: Array<(msg: Record<string, unknown>) => void> = [];

  // Attach listener BEFORE 'open' so messages queued during the upgrade are
  // captured. addClient() pushes 3 envelopes on connect — without this
  // ordering they get lost between 'open' and the first .next() call.
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    const resolver = waiting.shift();
    if (resolver) {
      resolver(msg);
    } else {
      queue.push(msg);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  // Server-side addClient() runs in the @fastify/websocket connection
  // callback AFTER the upgrade response is sent. Yield a macrotask so the
  // server has registered the session in `clients` before the caller calls
  // AnomalyDebugReplayService.start() (which immediately sendToSession()s).
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  return {
    ws,
    next: (timeoutMs = 30_000) => {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiting.indexOf(resolver);
          if (i >= 0) waiting.splice(i, 1);
          reject(new Error('receiveNext timeout'));
        }, timeoutMs);
        const resolver = (msg: Record<string, unknown>): void => {
          clearTimeout(timer);
          resolve(msg);
        };
        waiting.push(resolver);
      });
    },
    close: () => ws.close(),
  };
}

// Minimal logger shim for initBroadcaster.
const mockLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as Parameters<typeof initBroadcaster>[0];

// ---------------------------------------------------------------------------

describe('AnomalyDebugReplayService -- integration (real Docker PG)', () => {
  let app: FastifyInstance;
  let serverAddr: string;
  let cookie: string;
  let sessionId: string;

  beforeAll(async () => {
    // D-25 literal: install spy BEFORE drizzle(pool) is used by any replay
    // path. `db` = drizzle(pool) was already created at module import, but
    // drizzle leases clients via pool.connect() per transaction. Spying on
    // pool.connect catches every future lease; existing leases are a non-issue
    // because nothing in this file runs a transaction before beforeAll.
    installPoolQuerySpy();

    app = await buildWsApp();
    serverAddr = await app.listen({ port: 0, host: '127.0.0.1' });
    await initBroadcaster(mockLog);

    const user = await createSuperAdminUser();
    const session = await createSessionForUser(user.id);
    sessionId = session.sessionId;
    cookie = makeSignedCookie(sessionId);
  }, 30_000);

  afterAll(async () => {
    await clearWindow();
    shutdownBroadcaster();
    await app.close();
    // NOTE: do NOT pool.end() -- other test files in the same Vitest run
    // reuse this shared pool singleton. vi's fileParallelism: false means
    // files run sequentially, but closing the pool would break subsequent
    // files. The pool is process-scoped.
  });

  beforeEach(async () => {
    await clearWindow();
    queryLog.length = 0; // reset SQL capture buffer per test
  });

  afterEach(() => {
    // Do NOT vi.restoreAllMocks() here -- that would remove the pool.connect
    // spy installed in beforeAll and break the remaining tests. clearAllMocks
    // resets call history but keeps mockImplementation wired, so subsequent
    // connect() leases continue to capture.
    vi.clearAllMocks();
  });

  // --- Boundary row counts ------------------------------------------------

  for (const rowCount of [499, 500, 501, 1001]) {
    it(`cursor emits the full frame sequence for exactly ${rowCount} rows (D-25 SQL sequence)`, async () => {
      await seedRows(rowCount);
      queryLog.length = 0; // isolate cursor statements from the seed INSERTs

      const client = await openWs(serverAddr, cookie);

      // Drive the service directly -- the route layer is covered by Task 3.
      const { streamId } = AnomalyDebugReplayService.start(
        { from: WINDOW_FROM, to: WINDOW_TO },
        sessionId,
        app.log,
      );

      const frames: Array<Record<string, unknown>> = [];
      while (true) {
        const msg = await client.next(30_000);
        if ((msg as { streamId?: string }).streamId !== streamId) continue; // ignore unrelated broadcasts
        frames.push(msg);
        const phase = (msg as { phase?: string }).phase;
        if (phase === 'end' || phase === 'error') break;
      }

      // The terminal 'end' frame is emitted INSIDE db.transaction() before
      // the wrapper issues its COMMIT. Wait for COMMIT (or ROLLBACK) to land
      // in the spy's queryLog before asserting the SQL sequence.
      for (let i = 0; i < 50; i++) {
        if (queryLog.some((q) => /^\s*(COMMIT|ROLLBACK)\b/i.test(q))) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }

      client.close();

      // --- Frame assertions ---
      const endFrame = frames.at(-1) as { phase: string; processed?: number; ok?: boolean };
      expect(endFrame.phase).toBe('end');
      expect(endFrame.ok).toBe(true);
      expect(endFrame.processed).toBe(rowCount);

      // Monotonic seq.
      let lastSeq = -1;
      for (const f of frames) {
        const s = (f as { seq: number }).seq;
        expect(s).toBeGreaterThan(lastSeq);
        lastSeq = s;
      }

      // Frame-count sanity: at least floor(rowCount / 100) chunk frames.
      const chunkCount = frames.filter(
        (f) => (f as { phase: string }).phase === 'chunk',
      ).length;
      expect(chunkCount).toBeGreaterThanOrEqual(Math.floor(rowCount / 100));

      // --- D-25 literal SQL-sequence assertion ---
      // Expected ordered shape:
      //   BEGIN -> DECLARE replay_cursor NO SCROLL CURSOR
      //         -> FETCH FORWARD 500 x N
      //         -> CLOSE replay_cursor -> COMMIT.
      // Where N = ceil(rowCount / 500) when rowCount is NOT a multiple of 500,
      // and ceil(rowCount / 500) + 1 when rowCount IS a multiple (the extra
      // FETCH returns 0 rows and is what tells the cursor loop the window is
      // exhausted -- a fundamental property of the SQL FETCH protocol).
      const fetchCount = Math.ceil(rowCount / 500) + (rowCount % 500 === 0 ? 1 : 0);
      const expected: RegExp[] = [
        /^\s*BEGIN\b/i,
        /DECLARE\s+replay_cursor\s+NO\s+SCROLL\s+CURSOR/i,
        ...Array.from({ length: fetchCount }, () => /^\s*FETCH\s+FORWARD\s+500\s+FROM\s+replay_cursor\b/i),
        /^\s*CLOSE\s+replay_cursor\b/i,
        /^\s*COMMIT\b/i,
      ];
      const cursorStatements = cursorStatementsOnly();
      expect(cursorStatements.length).toBe(expected.length);
      cursorStatements.forEach((stmt, i) => expect(stmt).toMatch(expected[i]!));
    }, 90_000); // generous timeout for 1001 rows + SQL capture overhead
  }

  // --- D-25 10k-row abort mid-cursor -> CLOSE + ROLLBACK -------------------

  it('aborting at row ~500 on a 10k-row window emits CLOSE + ROLLBACK (D-25 literal)', async () => {
    // D-25 literal: seed 10,000 rows (not 1500). At FETCH 500/step, 10k = 20
    // FETCH cycles -- aborting after ~500 processed rows means we abort
    // between FETCH #1 and FETCH #2 (or during FETCH #2), which proves
    // mid-cursor abort under realistic load.
    await seedRows(10_000);
    queryLog.length = 0; // isolate cursor statements from seed INSERTs

    const client = await openWs(serverAddr, cookie);

    const { streamId } = AnomalyDebugReplayService.start(
      { from: WINDOW_FROM, to: WINDOW_TO },
      sessionId,
      app.log,
    );

    // Wait until the service has emitted ~5 chunk frames (~500 rows processed).
    let chunkSeen = 0;
    let guard = 0;
    while (chunkSeen < 5 && guard < 200) {
      const msg = await client.next(30_000);
      guard++;
      if ((msg as { streamId?: string }).streamId !== streamId) continue;
      if ((msg as { phase?: string }).phase === 'chunk') chunkSeen++;
    }

    // Abort -- flips the AbortController, which unwinds the cursor loop into
    // its `finally` (CLOSE replay_cursor) and triggers transaction ROLLBACK.
    const aborted = AnomalyDebugReplayService.cancel(streamId);
    expect(aborted).toBe(true);

    // Collect the terminal frame.
    let terminal: Record<string, unknown> | null = null;
    for (let i = 0; i < 300; i++) {
      const msg = await client.next(30_000);
      if ((msg as { streamId?: string }).streamId !== streamId) continue;
      const phase = (msg as { phase?: string }).phase;
      if (phase === 'error' || phase === 'end') {
        terminal = msg;
        break;
      }
    }

    // Wait for ROLLBACK to land in the spy's queryLog (issued by the
    // db.transaction wrapper after the cursor loop's `finally { CLOSE }`
    // unwinds with a thrown AbortError).
    for (let i = 0; i < 50; i++) {
      if (queryLog.some((q) => /^\s*(COMMIT|ROLLBACK)\b/i.test(q))) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    client.close();

    // --- Behavior-equivalent smokes (ADDITIONAL guards) ---
    expect(terminal).not.toBeNull();
    expect((terminal as { phase: string }).phase).toBe('error');
    expect((terminal as { code: string }).code).toMatch(/aborted|cancel/);
    expect(AnomalyDebugReplayService.getActiveJobCount()).toBe(0);

    // --- D-25 literal SQL-sequence tail assertion ---
    // Expected tail on abort: ... FETCH(s) -> CLOSE replay_cursor -> ROLLBACK.
    // FETCH count varies with abort timing -- we only assert the head
    // (BEGIN, DECLARE) and tail (CLOSE, ROLLBACK) plus presence of >=1 FETCH.
    const cursorStatements = cursorStatementsOnly();
    expect(cursorStatements.length).toBeGreaterThanOrEqual(5); // BEGIN + DECLARE + >=1 FETCH + CLOSE + ROLLBACK
    expect(cursorStatements[0]).toMatch(/^\s*BEGIN\b/i);
    expect(cursorStatements[1]).toMatch(/DECLARE\s+replay_cursor\s+NO\s+SCROLL\s+CURSOR/i);
    const tail = cursorStatements.slice(-2);
    expect(tail[0]).toMatch(/^\s*CLOSE\s+replay_cursor\b/i);
    expect(tail[1]).toMatch(/^\s*ROLLBACK\b/i);
  }, 180_000); // 10k seed + WS round-trips -- generous CI budget

  // --- D-08 concurrency semaphore -----------------------------------------

  it('activeJobs respects cap of 2 via the Map semaphore', async () => {
    await seedRows(5); // minimal rows so jobs run briefly

    const a = AnomalyDebugReplayService.start(
      { from: WINDOW_FROM, to: WINDOW_TO },
      sessionId,
      app.log,
    );
    const b = AnomalyDebugReplayService.start(
      { from: WINDOW_FROM, to: WINDOW_TO },
      sessionId,
      app.log,
    );

    // Third start MUST throw AnomalyReplayConcurrencyError.
    expect(() =>
      AnomalyDebugReplayService.start(
        { from: WINDOW_FROM, to: WINDOW_TO },
        sessionId,
        app.log,
      ),
    ).toThrow(/Replay concurrency limit/);

    expect(AnomalyDebugReplayService.getActiveJobCount()).toBeLessThanOrEqual(2);

    // Abort the two active jobs and let them drain.
    AnomalyDebugReplayService.cancel(a.streamId);
    AnomalyDebugReplayService.cancel(b.streamId);

    // Wait for the self-cleanup (.finally deletes from the Map).
    for (let i = 0; i < 40; i++) {
      if (AnomalyDebugReplayService.getActiveJobCount() === 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    expect(AnomalyDebugReplayService.getActiveJobCount()).toBe(0);
  }, 30_000);
});
