# Security

## Reporting a vulnerability

Please do not publish exploit details in a public issue. Report security-sensitive findings privately to the repository owner through GitHub's available private security reporting/contact mechanism.

Include the affected tool, reproduction steps, impact, and any proposed mitigation.

## File-processing threat model

DevToolkit accepts untrusted files. Public deployments should assume filenames, archive paths, image metadata, PDFs, source code, and file contents may be malicious.

The application therefore:

- validates client-provided relative paths before using them in ZIP entries
- enforces per-file and aggregate upload limits
- rejects obviously oversized requests from `Content-Length` before Multer disk writes when the header is available
- invokes Ghostscript without a shell and with its own hard timeout
- limits decoded image pixels and output dimensions
- bounds Sharp concurrency and cache usage
- uses one job identity across upload, progress, cancellation, and cleanup
- supports cooperative job cancellation and application-level job timeouts
- prevents duplicate active submissions using a stable request key
- uses temporary per-job upload directories with restrictive permissions
- automatically cleans stale processing files
- applies Helmet/CSP and production HSTS
- rate-limits application requests
- avoids rendering uploaded filenames as HTML in the shared processing workflow
- exposes separate liveness and readiness endpoints for production routing decisions
- stops accepting new mutations during graceful shutdown

## Production requirements

Do not expose the Node process directly to the internet. Use:

- HTTPS at a trusted reverse proxy or load balancer
- a reverse-proxy request-body limit at or below the application's configured upload ceiling
- a dedicated non-root service account or non-root container user
- OS/container CPU and memory limits
- a bounded writable temporary filesystem or volume
- `no-new-privileges` / equivalent sandboxing where your runtime supports it
- dependency vulnerability scanning and regular security updates
- centralized production logs that are not exposed directly to end users
- process supervision with SIGTERM-based graceful shutdown

Use `/healthz` for liveness and `/readyz` for readiness. Remove an instance from traffic when `/readyz` returns 503.

## Remaining high-scale hardening

The current job registry and SSE state are intentionally in-memory and single-instance. Before horizontal scaling or high-volume public workloads:

- move expensive processors into isolated worker processes/containers
- give workers explicit CPU, RAM, runtime, and temporary-storage quotas
- move job/progress state to a shared durable store when running multiple application instances
- store large results outside the Node process rather than retaining response blobs end-to-end
- add malware/content scanning if third-party or anonymous uploads are accepted at scale
- add broader integration, cancellation, malformed-file, and end-to-end security tests
