import { IndexedDBPaperStore, ACCOUNT_MODES } from './indexeddb-store.mjs';
import { PaperEngine, LIMITS, INSTRUMENT } from './core/core.mjs';
import { MemoryStore } from './core/storage.mjs';
import { readPublicEvidence } from './public-reader.mjs';
import { READINESS, assertPublicPilotReady } from './readiness.mjs';
const insist = (ok, code) => { if (!ok) throw Error(code); };
const PRIVATE = Symbol('PublicPaperController');
export const PRACTICE_ACK = 'START_ONE_FINITE_PUBLIC_PRICE_PAPER_PRACTICE';
export const RESUME_ACK = 'RESUME_FRESH_PROTECTIVE_EXIT_ONLY';
export class PublicPaperController {
  #store; #now; #fetch; #busy = false; #task = null; #epoch = 0; #suspended = false;
  #running = false; #error = null; #abort = null; #timer = null; #onChange; #runUntil = null; #cycles = 0; #maxCycles = 180;
  constructor(key, store, options) {
    insist(key === PRIVATE, 'USE_CREATE_OR_RECOVER'); this.#store = store;
    this.#now = options.now ?? Date.now; this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#onChange = options.onChange ?? (() => {});
  }
  static async create(options) {
    const store = await IndexedDBPaperStore.create({ accountId: options.accountId,
      accountMode: ACCOUNT_MODES.paper, acknowledgement: 'CREATE_ISOLATED_PUBLIC_PAPER_ACCOUNT', indexedDBFactory: options.indexedDBFactory });
    return new PublicPaperController(PRIVATE, store, options);
  }
  static async recover(options) {
    const store = await IndexedDBPaperStore.recover(options);
    const controller = new PublicPaperController(PRIVATE, store, options);
    try { await controller.#interruptSaved(); return controller; }
    catch (error) { store.close(); throw error; }
  }
  view() {
    const saved = this.#store.snapshot(), now = this.#now();
    let status = null, clockError = null;
    try { status = new PaperEngine(new MemoryStore({ state: saved.state })).status(now); }
    catch (error) { clockError = error.message; }
    return { ...saved, status, clockError, busy: this.#busy, running: this.#running,
      suspended: this.#suspended, lastError: this.#error, readiness: READINESS,
      ready: Object.values(READINESS).every(Boolean), limits: LIMITS,
      provenance: 'PUBLIC_PRICES_SIMULATED_FILLS_MODELED_COSTS_NO_ORDERS',
      lifecycle: saved.blocked ? 'STORAGE_BLOCKED_RECOVER' : clockError ? 'CLOCK_WARNING' : this.#suspended ? 'SUSPENDED_RECOVER' : saved.state.dataInterrupted ? saved.state.position ? this.#running ? 'PROTECTIVE_EXIT_ONLY' : 'INTERRUPTED_OPEN_POSITION' : 'INTERRUPTED_FLAT' : this.#running ? 'BROWSER_OPEN_PRACTICE' : saved.state.startedAtMs === null ? 'NOT_STARTED' : saved.state.position ? 'PAUSED_OPEN_POSITION' : 'STOPPED_FLAT' };
  }
  #fence(epoch) { insist(epoch === this.#epoch && !this.#suspended, 'LIFECYCLE_INTERRUPTED_RECOVER_FIRST'); }
  async #command(method, args) { return this.#store.execute(this.#store.snapshot().version + 1, method, args); }
  async #interruptSaved() {
    const s = this.#store.snapshot().state;
    if (s.startedAtMs !== null && (!s.dataInterrupted || s.protectiveResumedAtMs !== null))
      await this.#command('interrupt', [this.#now()]);
  }
  #notify() { try { this.#onChange(this.view()); } catch { /* observer cannot change accounting */ } }
  async #run(work) {
    insist(!this.#busy, 'CONTROLLER_OPERATION_IN_PROGRESS');
    insist(!this.#suspended, 'CONTROLLER_SUSPENDED_RECOVER_FIRST');
    insist(!this.#store.blocked, 'LOCAL_ACCOUNT_BLOCKED_RECOVER_FIRST');
    this.#busy = true; this.#error = null;
    this.#task = (async () => {
      try { return await work(); }
      catch (error) {
        this.#error = error.message; this.#running = false;
        clearTimeout(this.#timer);
        if (!this.#store.blocked) try { await this.#interruptSaved(); } catch (persistError) { this.#error += `; ${persistError.message}`; }
        throw error;
      } finally {
        if (this.#suspended && !this.#store.blocked) try { await this.#interruptSaved(); } catch (error) { this.#error = error.message; }
        this.#busy = false; this.#task = null; this.#notify();
      }
    })();
    return this.#task;
  }
  async start({ acknowledgement, expectedVersion, autoSchedule = true }) {
    // Gate is checked before any command or network call. No UI checkbox opens it.
    assertPublicPilotReady(); insist(acknowledgement === PRACTICE_ACK, 'EXPLICIT_PAPER_START_REQUIRED');
    const result = await this.#run(async () => {
      const epoch = this.#epoch;
      insist(this.#store.snapshot().version === expectedVersion, 'STALE_DISPLAY_RECOVER_FIRST');
      await this.#command('start', [{ id: 'owner_practice', acknowledgement, now: this.#now() }]);
      this.#fence(epoch);
      this.#running = true; this.#runUntil = this.#now() + LIMITS.pilotDurationMs; this.#cycles = 0; this.#maxCycles = 180;
      return { status: 'BROWSER_OPEN_PRACTICE_STARTED' };
    });
    if (autoSchedule) this.#schedule(); return result;
  }
  #schedule() {
    clearTimeout(this.#timer);
    if (!this.#running || this.#suspended) return;
    this.#timer = setTimeout(() => this.cycle().then(() => this.#schedule()).catch(() => {}), 1000);
  }
  // One cycle is serialized; requests are never retried automatically after failure.
  async cycle() {
    assertPublicPilotReady();
    return this.#run(async () => {
      insist(this.#running, 'PILOT_NOT_RUNNING');
      const epoch = this.#epoch;
      if (this.#now() >= this.#runUntil || this.#cycles++ >= this.#maxCycles) {
        this.#running = false; await this.#interruptSaved(); return { status: 'FINITE_WINDOW_ENDED_OPEN_POSITION_NOT_INVENTED_CLOSED' };
      }
      await this.#command('tick', [this.#now()]);
      this.#fence(epoch);
      let saved = this.#store.snapshot();
      if (!saved.state.position && !saved.state.intent && (!saved.state.entriesEnabled || saved.state.entryCount >= LIMITS.maxEntries)) {
        this.#running = false; return { status: 'FINITE_PRACTICE_FINISHED' };
      }
      // Do not issue a same-millisecond request and pretend it followed intent.
      if (saved.state.intent && this.#now() <= saved.state.intent.createdAtMs) return { status: 'WAITING_FOR_STRICTLY_LATER_REQUEST' };
      this.#abort = new AbortController();
      const evidence = await readPublicEvidence({ sessionId: `p_${saved.accountId.slice(0, 40)}`,
        localOrdinal: (saved.state.lastBook?.localOrdinal ?? 0) + 1,
        fetchImpl: this.#fetch, now: this.#now, signal: this.#abort.signal });
      insist(epoch === this.#epoch && !this.#suspended, 'PUBLIC_RESPONSE_INTERRUPTED_NOT_ADMITTED');
      const result = await this.#command('observePublicResponse', [evidence, this.#now()]);
      this.#fence(epoch);
      saved = this.#store.snapshot();
      if (saved.state.dataInterrupted && saved.state.protectiveResumedAtMs === null) { this.#running = false; return result; }
      if (saved.state.entriesEnabled && !saved.state.position && !saved.state.intent && saved.state.entryCount === 0) {
        const b = saved.state.lastBook;
        await this.#command('proposeBuy', [{ synthetic: false, id: 'owner_practice_entry', setupId: 'OWNER_PRACTICE',
          entryReason: 'One bounded paper mechanics exercise; no expected edge claimed.', expectedMoveBps: null,
          instrument: { ...INSTRUMENT }, snapshotOrdinal: b.localOrdinal, snapshotReceivedAtMs: b.receivedAtMs,
          snapshotAskMicros: b.askMicros }, this.#now()]);
        this.#fence(epoch);
      }
      if (!saved.state.position && !saved.state.intent && saved.state.entryCount >= LIMITS.maxEntries) this.#running = false;
      return result;
    });
  }
  async stop() {
    this.suspend();
    const pending = this.#task; if (pending) try { await pending; } catch {}
    if (!this.#store.blocked) await this.#interruptSaved();
    this.#notify(); return { status: 'ENTRIES_PERMANENTLY_STOPPED_NO_EXIT_INVENTED' };
  }
  suspend() {
    this.#epoch++; this.#suspended = true; this.#running = false;
    this.#abort?.abort(); clearTimeout(this.#timer); this.#notify();
  }
  async recover() {
    insist(!this.#busy, 'CONTROLLER_OPERATION_IN_PROGRESS');
    clearTimeout(this.#timer); this.#running = false; this.#busy = true; const epoch = this.#epoch;
    try { await this.#store.recover(); await this.#interruptSaved(); insist(epoch === this.#epoch, 'RECOVERY_INTERRUPTED'); this.#suspended = false; this.#error = null; }
    catch (error) { this.#suspended = true; this.#error = error.message; throw error; }
    finally { this.#busy = false; this.#notify(); }
    return this.view();
  }
  async resumeProtective({ acknowledgement, autoSchedule = true }) {
    assertPublicPilotReady();
    await this.#run(async () => { const epoch = this.#epoch; await this.#command('resumeProtective', [{ acknowledgement, now: this.#now() }]); this.#fence(epoch); this.#running = true; this.#runUntil = this.#now() + LIMITS.maxHoldingMs; this.#cycles = 0; this.#maxCycles = 60; });
    if (autoSchedule) this.#schedule();
  }
  close() { insist(!this.#busy, 'CONTROLLER_OPERATION_IN_PROGRESS'); this.suspend(); this.#store.close(); }
  injectFault(point) { this.#store.injectFault(point); }
}
