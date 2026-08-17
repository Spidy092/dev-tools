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
- `GET /readyz` for readiness. A 200 response means the instance is accepting work and its temp directories/memory guard are healthy. A 503 means the instance should be removed from new traffic.

Do not use `/healthz` alone for load-balancer routing during deployments; readiness intentionally becomes false during graceful shutdown.

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

Adjust the exact limits to your workload instead of automatically increasing them when a request fails.

## Graceful shutdown

The server handles `SIGTERM` and `SIGINT` by:

1. marking readiness false and rejecting new mutating requests,
2. stopping acceptance of new HTTP connections,
3. allowing active work a configurable grace period,
4. requesting cancellation of remaining active jobs after the grace period,
5. closing progress/SSE connections and exiting.

Configure your process supervisor or container platform to send SIGTERM and give the process at least `SHUTDOWN_GRACE_MS` plus a small buffer before issuing SIGKILL.

## Resource limits

Important environment controls include:

- `MAX_FILE_SIZE_MB`, `MAX_TOTAL_SIZE_MB`, `MAX_FILES`
- `MAX_REQUEST_SIZE_MB`
- `JOB_TIMEOUT_MS`
- `PDF_PROCESS_TIMEOUT_MS`
- `MAX_IMAGE_PIXELS`, `MAX_IMAGE_OUTPUT_WIDTH`
- `SHARP_CONCURRENCY`
- `SHARP_CACHE_MEMORY_MB`, `SHARP_CACHE_FILES`, `SHARP_CACHE_ITEMS`
- `READINESS_MAX_HEAP_MB`

The application default Node start command uses a 2 GB old-space ceiling. Keep `READINESS_MAX_HEAP_MB` below that ceiling so the instance can become unready before memory exhaustion.

## Temporary storage

`uploads/` and `tmp/` must be writable by the service user and should not be shared with unrelated applications. Use a bounded filesystem/volume so malicious or unusually large workloads cannot consume the host root filesystem.

Stale-file cleanup is a safety net, not a substitute for bounded storage.

## Current scaling boundary

The current production model is one application instance with in-memory job/progress state. Do not place multiple independent Node instances behind a load balancer without first moving job/progress state to a shared store or adding strict session affinity with understood failure behavior.

For high-volume public deployment, the next architectural step is isolated processing workers with shared job state and external result storage.
