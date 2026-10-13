# Independent journal and rollover review

Reviewed 11 October 2026, Node v24.19.0, against preserved first-slice tree `cc02395ed39579b4530c8e5622ae3000f13cf1ea`. Conclusion: no remaining identified must-fix defect in the reviewed local journal, checkpoint and rollover scope. This does **not** approve continuous operation, public-price simulated execution or deployment.

The independent reviewer authored only `test/journal-adversarial.test.mjs` and this report for this stage, and did not edit the implementation. Implementation owners made the fixes. Design-time agents are reviewers/developers, not running trading workers. The earlier review and artifacts remain historical evidence rather than being rewritten to claim capabilities they did not contain.

## Evidence and reproduction

```sh
node --test test/journal-adversarial.test.mjs
npm test
git diff --check
git diff --cached --check
```

- Preserved baseline, re-run before changes: **112 total, 110 passed, 0 failed, 2 skipped**.
- New independent journal suite: **29 total, 29 passed, 0 failed, 0 skipped, 0 cancelled**.
- Final aggregate run: **171 total, 169 passed, 0 failed, 2 skipped, 0 cancelled**, exit code **0**. The complete output is supplied as `/workspace/neptune-deliverables/journal-stage/test-results.txt`. Both staged and unstaged diff checks pass.

The independent suite includes nine injected filesystem-error cases and eight abrupt-process-exit cases. Inputs are invented synthetic fixtures. Filesystem faults patch Node's built-in filesystem methods in isolated child processes, explicitly require proof that the selected injection fired, and never alter the parent process's filesystem methods or security settings. Test state lives in newly created temporary directories. No network, browser, public-price trades, wallets, exchange orders, migrations of user data or remote-ref operations are involved.

## Verified behavior

**One authoritative commit.** Each acknowledged typed command has recorded JSON input and explicit clocks, before/after documents, decision and execution. Journal evidence is durable before `state.json` publishes its head; the final directory sync precedes acknowledgement. Reopening after a failed operation sees the old committed state or the new committed state with complete matching evidence. A thrown error after publication is not proof that a fill did not commit.

**Retries and evidence.** Unique prepared files keep interrupted writes away from immutable final record names. Partial prepared files and complete uncommitted records are retained as evidence. Exact-command retries after injected partial writes succeed without a second fill, and pre-existing evidence bytes remain unchanged. The committed head, not the newest filename, determines history. Crashed writer locks require explicit recovery and retain their evidence.

**Recorded decisions and replay.** Independent file inspection checks record hashes and sequential links. `journal-audit` replays typed commands, including rejected or duplicate attempts. A test changes a recorded input and recomputes both the record hash and state-envelope checksum: full command replay still detects that the resulting state does not match. This is semantic replay validation, not authentication against someone who can rewrite all local data and its origin.

**Count rollover and archive identity.** A protective exit occurs with the active event array already full, while STOP remains active. Financial state and lifetime counts remain correct. A separate persisted sequence crosses the 128-position directory boundary and reaches 132 committed records: an archived event ID resubmitted with a newer timestamp is rejected, and a new ID with an old source timestamp is also rejected. Neither active compaction nor archive segmentation resets product source high-water marks.

**Byte rollover.** A synthetic existing ledger with many 1,000-leg fills is sized so the next protective SELL would push the uncompacted engine above 2 MiB while remaining below its event-count limit. The runtime commits the input and resulting checkpoint together, retains the last SELL for display, stays within its active byte budget, and exactly matches the uncompacted reference account. Reopen, archive-ID protection and full journal audit pass. An irreducibly oversized migrated state rejects a typed update without acknowledgement or replacing the committed snapshot.

**Accounting and controls.** Checkpoint tests compare cash, held quantity/cost basis, realized P/L, fees, peak equity, risk halt, STOP generation, source high-water marks and lifetime counts. The independent count-boundary example starts at USD 1,000, buys one unit at 100 with a 0.2 fee, then exits at 98.9 with a 0.1978 fee: final cash is **998.5022**. Compaction does not manufacture funding or erase losses. The pure engine refuses history eviction without explicit durable-archive acknowledgement and requires archive membership evidence after compaction.

**Migration boundaries.** A frozen schema-1 envelope was captured from the actual reviewed baseline before implementation changed. Migration retains its exact original bytes and checksum, preserves its account/control/source identity, and reports unreconstructible earlier inputs. Writes before explicit migration fail. Earlier event IDs remain protected after migration and later compaction. A second, explicitly synthetic legacy representation is used solely to construct the large byte-boundary challenge efficiently. Neither case invents a historical input stream.

## Fault and crash matrix

Every case below passed. Error cases return no success acknowledgement; crash cases exit before any success response and leave a lock requiring explicit recovery. All retries reconcile to one fill.

| Injected error | Committed state after reopen |
| --- | --- |
| ENOSPC before prepared journal bytes | Previous head; incomplete evidence retained |
| ENOSPC during a partial prepared journal write | Previous head; partial evidence retained |
| EIO before prepared journal fsync | Previous head |
| EIO before published record fsync | Previous head |
| ENOSPC before snapshot write | Previous head; complete record remains uncommitted |
| EIO before snapshot fsync | Previous head |
| EIO before authoritative snapshot rename | Previous head |
| EIO after authoritative snapshot rename | New coherent head; no success acknowledgement |
| EIO before final state-directory fsync | New coherent head; no success acknowledgement |

Abrupt exits were injected before journal bytes, during journal bytes, after prepared-file fsync, after immutable record linking, after published-record fsync, during snapshot bytes, after the authoritative rename, and after final directory fsync but before acknowledgement. The first six preserve the previous committed head; the last two reopen the new coherent head. Recovery and retry preserve one accounting effect in all eight cases.

Missing, truncated and changed committed archives fail closed. A missing authoritative snapshot when journal evidence exists cannot silently create a new account. Generic document updates cannot bypass typed engine commands. Existing baseline tests continue to cover concurrent writers, live-owner recovery denial, recovery guards, corruption and durable STOP acknowledgement.

## Review changes and remaining limits

The review challenged partial writes occupying immutable record names and the original count-only retention limit. The final implementation publishes through unique prepared files and includes a 2 MiB runtime compaction budget. The final README and continuation manifest describe these behaviors and distinguish committed-command completeness from precommit failures. The README wording was corrected so the next two-book latency design is not described as already tested.

Remaining limits are explicit:

- Disk history grows without pruning. Reads and duplicate lookup scan history; full command replay can be quadratic. Active-state bounds do not establish continuous-operation throughput, finite total disk use or prompt protective exits under load.
- A filesystem failure, corrupt archive, irreducibly oversized state, slow scan or unavailable fresh quote can still block processing and durable STOP acknowledgement. No disk reserve or guaranteed liquidation exists.
- These tests simulate ENOSPC/EIO and kill child processes at software boundaries. They do not physically exhaust a disk, cut machine power, validate every filesystem/controller cache, establish NFS/distributed safety, or replace backup/recovery operations testing.
- Normal reads verify integrity and state-chain continuity; full command semantics are checked by `journal-audit`. Replay requires the matching source revision. SHA-256 is not a signature or a defense against wholesale local history replacement.
- Fresh stores contain complete **committed-command** history. Malformed/oversized commands rejected before commit and failed writes cannot promise a durable record. Migration cannot recover earlier missing inputs. The journal preserves parsed JSON values; only legacy migration preserves original envelope bytes.
- The emergency control remains an entry pause with eligible fresh synthetic protective exits. Zero-latency immediate-or-cancel remains the only execution timing model. Positive latency, a pending-order lifecycle and two-book causality are design work for a later stage.
- Native browser/layout/accessibility, current venue connectivity/payload compatibility, an installed persistent service and unattended operation remain unverified. The two original explicit skips remain. No profitability or broad-market claim follows from these tests.

The next coding step is to implement and independently test the proposed synthetic pending-order/arrival-book model. Supported native preview review and a successful read-only venue observation remain separate launch gates. Publication is still separately coordinated.
