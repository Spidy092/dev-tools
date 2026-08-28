# Production Deployment

DevToolkit performs CPU-, memory-, and disk-intensive file processing. Treat the web process as an application service behind a trusted reverse proxy; do not expose the Node listener directly to the public internet.

## Runtime baseline

- Run with `NODE_ENV=production`.
- Run Node as a dedicated non-root user.
- Keep the application directory read-only except for the intended `uploads/` and `tmp/` locations.
- Put CPU, memory, PID, and temporary-storage limits around the process/container.
- Terminate HTTPS at a trusted proxy/load balancer.
- Forward the real client IP only from trusted proxy hops and configure `TRUST_PROXY` accordingly.

## Health checks

Use:

- `GET /healthz` for liveness. A 200 response means the Node process is alive.
- `GET /readyz` for readiness. A 200 response means the instance is accepting work, its temp directories/memory guard are healthy, and the processing admission controller still has immediate or queued capacity. A 503 means the instance should be removed from new traffic until pressure falls.

Readiness intentionally becomes false during graceful shutdown and when the configured processing queue reaches its hard admission ceiling. Do not use `/healthz` alone for load-balancer routing.

`/readyz` exposes current job phases plus admission state, including active jobs/units/bytes, queued jobs/bytes, oldest queue wait, processor-kind counts, and configured limits. Treat this as operational state; do not expose internal health endpoints through an untrusted public surface unless that disclosure is acceptable for your deployment.

## Reverse proxy upload limit

Set the proxy request-body ceiling at or below the application limit. With the default application settings, a sensible Nginx starting point is:

```nginx
client_max_body_size 505m;
proxy_request_buffering off;
proxy_read_timeout 370s;
proxy_send_timeout 370s;
```

The application still enforces per-file and aggregate limits. The proxy limit exists to reject oversized bodies before they consume application disk or bandwidth.

## Nginx proxy example

```nginx
server {
    listen 443 ssl http2;
    server_name tools.example.com;

    client_max_body_size 505m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 370s;
        proxy_send_timeout 370s;
    }

    location /progress/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 370s;
    }
}
```

Adjust exact limits to your workload instead of automatically increasing them when a request fails.

## Global processing admission and backpressure

DevToolkit uses an in-process weighted admission controller. An uploaded job does not begin processor work until it owns an admission lease.

Default limits:

- `MAX_ACTIVE_PROCESSING_JOBS=4`
- `MAX_ACTIVE_PROCESSING_UNITS=8`
- `MAX_ACTIVE_PROCESSING_MB=1024`
- `MAX_QUEUED_PROCESSING_JOBS=16`
- `MAX_QUEUED_PROCESSING_MB=2048`
- `ADMISSION_MAX_WAIT_MS=120000`
- `ADMISSION_MAX_BYPASSES=3`

Base processing cost is intentionally unequal: rename/passthrough and checksums are light; duplicate/text/PHP are medium; minification is heavier; image and PDF/Ghostscript work are heaviest. Large byte totals and projects with thousands of files consume extra units.

The scheduler independently enforces active job count, active weighted units, active declared bytes, queued job count, and queued declared bytes. A job that cannot run immediately may queue only while all queue ceilings have room. A saturated queue returns HTTP `503` with `Retry-After`; callers should retry with backoff rather than hot-looping.

Small jobs may use spare capacity ahead of a temporarily blocked large job, but bypassing is bounded so a large queued job cannot be starved indefinitely.

### Timeout relationship

Keep timeout layers ordered intentionally. A useful rule is:

```text
ADMISSION_MAX_WAIT_MS < JOB_TIMEOUT_MS < REQUEST_TIMEOUT_MS < reverse-proxy timeout
```

With the defaults, admission may wait up to 120 seconds inside a 300-second job timeout and a 360-second HTTP request timeout. If you increase queue wait, also review the job, Node request, load-balancer, and proxy timeouts. Do not raise only one layer.

### Temp-disk impact of queueing

Weighted admission occurs after Multer has completed and validated an upload because the scheduler needs the actual file count and declared byte total. Therefore queued jobs retain their uploaded temporary files while they wait.

Provision the temporary filesystem for at least:

```text
active uploaded bytes
+ queued uploaded bytes
+ processor temporary/output files
+ safety headroom
```

`MAX_QUEUED_PROCESSING_MB` is an admission accounting ceiling, not a filesystem quota. A bounded container/volume remains required. Output expansion can exceed input bytes, and Ghostscript/image transformations may require additional temporary/output space.

The pre-upload saturation guard rejects known processor POSTs before Multer when the queue is already at its hard ceiling. However, uploads that started while capacity was available can still be concurrently in flight before they reach post-upload admission. For hostile/high-volume public hosting, keep reverse-proxy request limits, request-rate controls, and a bounded temp volume; a future upload-reservation layer is the next stronger defense.

## Graceful shutdown

The server handles `SIGTERM` and `SIGINT` by:

1. marking readiness false,
2. permanently closing processing admission so no queued or in-flight upload can obtain a new processing lease,
3. rejecting/flushing queued admission waiters,
4. stopping acceptance of new HTTP connections,
5. allowing already admitted work a configurable grace period,
6. requesting cancellation of remaining active jobs after the grace period,
7. closing progress/SSE connections and exiting.

Configure your process supervisor or container platform to send SIGTERM and give the process at least `SHUTDOWN_GRACE_MS` plus a small buffer before issuing SIGKILL.

## Resource limits

Important environment controls include:

- `MAX_FILE_SIZE_MB`, `MAX_TOTAL_SIZE_MB`, `MAX_FILES`
- `MAX_REQUEST_SIZE_MB`
- `JOB_TIMEOUT_MS`, `JOB_TTL_MS`
- `MAX_ACTIVE_PROCESSING_JOBS`, `MAX_ACTIVE_PROCESSING_UNITS`, `MAX_ACTIVE_PROCESSING_MB`
- `MAX_QUEUED_PROCESSING_JOBS`, `MAX_QUEUED_PROCESSING_MB`
- `ADMISSION_MAX_WAIT_MS`, `ADMISSION_MAX_BYPASSES`
- `MAX_CODE_BUFFER_BYTES`, `MAX_TEXT_BUFFER_BYTES`, `MAX_IMAGE_BUFFER_BYTES`, `MAX_ARCHIVE_BUFFER_BYTES`, `MAX_CORE_BATCH_BYTES`
- `PDF_PROCESS_TIMEOUT_MS`
- `MAX_IMAGE_PIXELS`, `MAX_IMAGE_OUTPUT_WIDTH`
- `SHARP_CONCURRENCY`
- `SHARP_CACHE_MEMORY_MB`, `SHARP_CACHE_FILES`, `SHARP_CACHE_ITEMS`
- `READINESS_MAX_HEAP_MB`

The application default Node start command uses a 2 GB old-space ceiling. Keep `READINESS_MAX_HEAP_MB` below that ceiling so the instance can become unready before memory exhaustion.

Lower admission limits first on small hosts. Do not compensate for overload by increasing active jobs, Sharp concurrency, queue depth, memory ceilings, and timeouts simultaneously; doing so removes backpressure instead of adding capacity.

## Temporary storage

`uploads/` and `tmp/` must be writable by the service user and should not be shared with unrelated applications. Use a bounded filesystem/volume so malicious or unusually large workloads cannot consume the host root filesystem.

Stale-file cleanup is a safety net, not a substitute for bounded storage. Admission rejection after upload cleans that job immediately, while successfully admitted/queued uploads are retained only for their lifecycle plus cleanup safeguards.

Monitor volume utilization separately from Node heap. Disk exhaustion can occur while heap usage remains healthy.

## Current scaling boundary

The current production model is one application instance with in-memory job/progress/admission state. The admission controller protects aggregate work **inside one Node process only**.

Do not assume that two independent Node instances coordinate their active units or queue byte budgets. Before horizontal scaling, move job and admission state to shared infrastructure or introduce an external durable queue/worker scheduler. Session affinity alone does not provide global capacity accounting.

For high-volume public deployment, the next architectural steps are upload/temp-storage reservation, isolated processing workers, shared job/admission state, external result storage, and structured resource metrics.
