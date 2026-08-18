# DevToolkit Core Processing Engine

The `core/` layer is the trust boundary between validated user intent and file processing. HTTP routes, the CLI, and future workers should call core APIs instead of implementing ad-hoc filesystem loops.

## Non-negotiable invariants

Every file processor should follow these rules:

1. **Regular files only** — reject final-path symbolic links and non-regular files for core file reads.
2. **Never trust declared metadata alone** — compare an expected upload size with the opened file's actual size when an expected size is available.
3. **Detect files changing during processing** — verify size/inode/timestamps after reads and fail instead of returning a result from an unstable input.
4. **Bound every resource** — cap file count, aggregate declared bytes, per-file buffered bytes, I/O chunk size, and concurrency.
5. **Stream by default** — hashing and fingerprints use bounded reads. A processor may materialize a full file only through a bounded API such as `readFileBuffer()` with an explicit maximum.
6. **Cancellation is cooperative and frequent** — check cancellation/abort before opening a file and between I/O chunks.
7. **Deterministic outputs** — concurrency may change completion order, but returned reports/manifests must use deterministic ordering.
8. **Fail closed on ambiguous input** — unsupported encodings, malformed Unicode, invalid paths, invalid algorithms, and inconsistent metadata must never be guessed into a successful transformation.
9. **Exact equality requires exact verification** — duplicate fingerprints are only a prefilter; duplicate files require full SHA-256 equality.
10. **Core safety must not depend on Express** — the same protections must apply when a core module is called from the CLI, tests, or future worker processes.

## `processingEngine.js`

Shared enterprise primitives:

- `validateFileItems()` — file-count, declared-size, duplicate logical-path, and item validation.
- `hashFile()` — chunked SHA-256 with expected-size and change-during-read verification.
- `fingerprintFile()` — bounded prefix/suffix fingerprint for cheap candidate elimination; never treated as proof of equality.
- `readFileBuffer()` — full-file materialization only when the caller provides an explicit memory ceiling.
- `statRegularFile()` — safe regular-file metadata access.
- `mapLimit()` — bounded asynchronous concurrency while preserving input result order.
- `assertActive()` — cooperative cancellation/abort boundary.

### Default resource policy

- I/O chunk: 1 MiB by default, clamped to 64 KiB–8 MiB.
- Core concurrency: CPU-aware default, clamped to 1–8.
- General core list limit: 10,000 items unless a stricter caller limit is supplied.
- Text normalization buffered file limit: 32 MiB by default.

HTTP upload limits remain an outer defense. Core limits are a second defense for CLI/future worker callers.

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

## Remaining enterprise engine work

These are core/platform priorities before adding many more tools:

- migrate remaining routes that still call `fs.readFile()` directly onto core I/O primitives
- introduce a shared archive writer with explicit backpressure/error/cancellation handling
- stream text normalization for very large files instead of buffering
- add global/admission concurrency limits across simultaneous jobs, not only within one job
- move CPU-heavy work into worker processes/containers before public high-volume hosting
- add per-operation resource budgets and structured metrics
- add filesystem fault-injection tests (permission errors, disk-full/write failure, truncated uploads)
- add property/fuzz tests for paths, manifests, encodings, and rename rules
- move job state to shared infrastructure before horizontal scaling

Do not weaken these invariants to make a new tool easier to implement. New tools should fit the engine, not bypass it.
