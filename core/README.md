# DevToolkit Core Processing Engine

The `core/` layer is the trust boundary between validated user intent and file processing. HTTP routes, the CLI, and future workers should call core APIs instead of implementing ad-hoc filesystem loops.

## Non-negotiable invariants

Every file processor should follow these rules:

1. **Regular files only** — reject final-path symbolic links and non-regular files for core file reads.
2. **Never trust declared metadata alone** — compare an expected upload size with the opened file's actual size when an expected size is available.
3. **Detect files changing during processing** — verify size/inode/timestamps after reads and fail instead of returning a result from an unstable input.
4. **Bound every resource** — cap file count, aggregate declared bytes, per-file buffered bytes, I/O chunk size, concurrency, and simultaneous admitted work.
5. **Stream by default** — hashing, passthrough copies, archive sources, and fingerprints use bounded reads. A processor may materialize a full file only through a bounded API such as `readFileBuffer()` with an explicit maximum.
6. **Cancellation is cooperative and frequent** — check cancellation/abort before opening a file and between I/O chunks. Child processes must also terminate when their job aborts.
7. **Deterministic outputs** — concurrency may change completion order, but reports/manifests/archive metadata must be deterministic where the format allows it.
8. **Fail closed on ambiguous input** — unsupported encodings, malformed Unicode, invalid paths, invalid algorithms, and inconsistent metadata must never be guessed into a successful transformation.
9. **Exact equality requires exact verification** — duplicate fingerprints are only a prefilter; duplicate files require full SHA-256 equality.
10. **Core safety must not depend on Express** — the same protections must apply when a core module is called from the CLI, tests, or future worker processes.
11. **Archive extraction must be portable by default** — reject traversal, absolute paths, Windows reserved names, case-fold collisions, control characters, unsafe punctuation, and overlong path segments.
12. **Untouched files should remain untouched** — if a tool does not need to transform a file, stream verified original bytes instead of decoding/re-encoding them.
13. **Heavy work requires admission** — web processors must not begin CPU/I/O-heavy work until the global scheduler grants a lease.

## `processingEngine.js`

Shared enterprise primitives:

- `validateFileItems()` — file-count, declared-size, duplicate logical-path, and item validation.
- `hashFile()` — chunked SHA-256 with expected-size and change-during-read verification.
- `fingerprintFile()` — bounded prefix/suffix fingerprint for cheap candidate elimination; never treated as proof of equality.
- `readFileBuffer()` — full-file materialization only when the caller provides an explicit memory ceiling.
- `createVerifiedReadStream()` — lazy bounded streaming with expected-size, cancellation, end-of-read stability verification, and verified completion callback.
- `statRegularFile()` — regular-file metadata access through the same trust boundary.
- `mapLimit()` — bounded asynchronous concurrency while preserving input result order.
- `assertActive()` — cooperative cancellation/AbortSignal boundary.

## `archiveEngine.js`

All ZIP-producing web routes and the CLI should use this layer instead of constructing `archiver` instances directly.

Guarantees:

- lazy source opening so large projects do not hold thousands of file descriptors open
- verified streaming for file-backed entries
- explicit buffer ceilings for transformed entries
- duplicate archive-path rejection
- case-insensitive collision rejection by default
- traversal, absolute-path, control-character and null-byte rejection
- Windows reserved-name and unsafe-character rejection by default
- 255-byte segment and 4096-byte full-path ceilings
- deterministic ZIP-safe 1980 entry timestamp by default
- cancellation aborts both archive work and active source streams
- destination errors propagate instead of producing a falsely successful job
- progress completion can be emitted only after a source has been fully consumed

Portable archive checks may be disabled only for an explicitly platform-specific caller with `portable: false`.

## `resourcePolicy.js`

Core resource budgets are an inner defense used by web routes, the CLI, and future workers. Defaults:

- code/source buffered file: 16 MiB
- generic text buffered file: 32 MiB
- image input/output buffer: 64 MiB
- generic archive transformed buffer: 64 MiB
- aggregate core batch declaration: 1 GiB
- general core file list: 10,000 files

Environment overrides are bounded by hard ceilings so a configuration typo cannot silently remove all resource protection.

HTTP upload limits remain an outer defense. Core limits are deliberately independent so CLI/future worker callers retain protection.

## `admissionController.js`

The global scheduler protects one Node instance from aggregate overload across simultaneous requests.

A processing request receives a weighted cost based on processor type, declared bytes, and file count. The web lifecycle is:

```text
uploading
   ↓
validated upload
   ↓
weighted admission
   ├── run now
   ├── queue
   └── reject / timeout
   ↓
running
   ↓
response finish / abort
   ↓
lease released
```

Default web policy:

- maximum active jobs: 4
- maximum active processing units: 8
- maximum active declared bytes: 1 GiB
- maximum queued jobs: 16
- maximum queued declared bytes: 2 GiB
- maximum queue wait: 120 seconds
- maximum bypasses before starvation protection: 3

Base processor units:

- passthrough/rename stream: 1
- checksum: 1
- duplicate scan: 2
- text normalization: 2
- PHP processing: 2
- code minification: 3
- image processing: 4
- PDF/Ghostscript: 4

Very large batches and projects with thousands of files receive additional units. The cost is capped to the configured instance unit capacity so custom smaller deployments remain usable.

Admission guarantees:

- active job, unit, and byte ceilings are independent
- queued job and byte ceilings are independent
- queue-full work receives `503` and `Retry-After`
- queue timeout fails explicitly rather than waiting forever
- user/client cancellation removes queued work immediately
- a processing lease is retained until the HTTP response actually finishes or closes
- limited bypassing lets small work use spare capacity while preventing starvation of a larger queued job
- queue positions are refreshed when earlier jobs leave
- progress/metrics observer failures cannot corrupt scheduler accounting
- shutdown permanently closes admission before active jobs are drained/cancelled
- `/readyz` exposes scheduler pressure and becomes unavailable when the instance cannot accept more processing work
- known processing POSTs are rejected before upload when the queue is already at its hard ceiling

The in-process scheduler is intentionally a **single-instance** boundary. Horizontal scaling requires shared admission/job state or an external queue; do not assume independent Node processes coordinate these limits.

## `textCodec.js`

Source-code processors use strict UTF-8 decoding:

- UTF-8 and UTF-8 BOM are accepted.
- UTF-16 BOM input is rejected for UTF-8-only processors.
- malformed UTF-8 is rejected.
- null-byte/binary input is rejected by default.
- decoders never silently substitute replacement characters into source code.

PHP Protector and Code Minifier use this rule.

## Duplicate Finder pipeline

```text
size grouping
    ↓
prefix/suffix SHA-256 fingerprint
    ↓
full SHA-256 only for surviving candidates
    ↓
exact duplicate groups
```

A fingerprint collision cannot produce a false duplicate because all surviving files are fully hashed before grouping.

## Checksum / Manifest pipeline

Manifest generation hashes files with bounded concurrency and sorts manifest entries by normalized relative path before returning them.

Verification first rejects obvious size mismatches, then hashes only equal-size expected files. Results (`valid`, `changed`, `missing`, `added`) are sorted deterministically.

## Text normalization policy

Recognized inputs:

- UTF-8
- UTF-8 with BOM
- UTF-16LE with BOM
- UTF-16BE with BOM

Unicode decoding is fatal/strict. Invalid UTF-8, malformed UTF-16, binary/null-byte input, or unknown encoding is passed through unchanged rather than repaired or guessed.

`normalizeFile()` performs a verified bounded read before normalization. Large text files that exceed the configured memory ceiling must fail explicitly until a future streaming text transformer is implemented.

## PDF / child-process policy

Ghostscript runs without a shell and now consumes the same job AbortSignal. Cancellation or timeout actively kills the child process. Input and generated output files are verified as regular files, stale output is removed before execution, and stderr capture is bounded.

A bulk PDF may fall back to the original only for a document-specific Ghostscript failure/timeout. Infrastructure failure such as Ghostscript being unavailable fails the request instead of silently returning an uncompressed batch.

## Directory walking / CLI policy

`walkDir()` is iterative rather than recursive, deterministic, bounded by file/directory/depth ceilings, ignores symlinks and special files, and rejects paths escaping the requested base.

PHP CLI output must live outside the input tree. CLI ZIP creation uses the same archive engine as the web app.

## Remaining enterprise engine work

The main Phase 2 items still outstanding are:

- streaming text normalization for files larger than the bounded in-memory text budget
- worker-process/container isolation for CPU-heavy Sharp/minifier/Ghostscript workloads before high-volume public hosting
- structured resource metrics (bytes read/written, processor time, queue time, cancellations, memory pressure)
- filesystem fault-injection tests (permission errors, disk-full/write failure, truncated uploads)
- property/fuzz tests for paths, manifests, encodings, rename rules, archive names, and malformed media
- safer atomic filesystem output primitives for CLI folder writes
- shared job/admission state or an external queue before horizontal scaling

Do not weaken these invariants to make a new tool easier to implement. New tools should fit the engine, not bypass it.
