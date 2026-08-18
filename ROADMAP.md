# DevToolkit Roadmap

DevToolkit's goal is to become the best open-source **bulk developer operations toolbox**: one place to process single files, large selections, complete folders, and repeatable project workflows without learning a different UI for every utility.

The roadmap is directional, not a promise of dates. Priorities can change based on security, contributor interest, real-world usage, and maintenance cost.

## Product position

DevToolkit should not compete by merely having the longest list of tiny utilities.

Our differentiators should be:

1. **Bulk + folder first** — tools should work well on dozens, hundreds, or thousands of files where sensible.
2. **Preview before mutation** — users should be able to understand what will change before processing.
3. **Repeatable workflows** — save/reuse tool settings and eventually compose multi-step workflows.
4. **Self-hostable and open source** — teams can run it in an environment they control.
5. **Consistent UX** — Select → Review → Configure → Preview → Process → Results across the catalog.
6. **Honest privacy** — clearly distinguish server-side processing from browser-local analysis.

## Phase 1 — Launch-quality foundation

- [x] Enterprise EJS/Express UI foundation
- [x] Shared tool registry and workflow
- [x] Bulk queue and results UX
- [x] Unified job/progress/cancellation lifecycle
- [x] Security hardening for uploads, paths, Sharp, and Ghostscript
- [x] Health/readiness and graceful shutdown
- [x] Integration/security/runtime test coverage
- [x] GitHub Actions CI
- [x] Open-source license and contributor documentation
- [x] Structured issue and pull-request templates
- [x] Project website for GitHub Pages
- [x] Clean repository-root application structure
- [ ] First public release
- [ ] Screenshots and short workflow demo/GIF
- [ ] Clean-clone validation from `main`

## Phase 2 — Make bulk workflows meaningfully better than alternatives

### Preview and safety

- [x] Shared dry-run/preview contract before processing
- [x] Rename preview showing old path → new path before execution
- [ ] Image before/after visual preview with output size estimate
- [ ] Minifier diff/size preview
- [ ] PDF expected-quality/size guidance
- [x] Collision detection and conflict-resolution preview for file outputs

### Reusable work

- [x] Save named presets per tool
- [x] Export/import presets as versioned JSON
- [ ] Recent-job configuration history without storing uploaded file contents
- [ ] Copy/share a tool configuration link when settings are URL-safe

### Better large-folder experience

- [x] Folder summary before processing: file counts, total bytes, extensions, largest files
- [x] Quick grouping/selection by major file type and large files
- [ ] Group/filter queue by directory
- [ ] Select by glob/pattern beyond exclusion rules
- [ ] Per-folder result summaries
- [ ] Stream large result archives instead of retaining large blobs in browser memory

## Phase 3 — High-value tool gaps

Add tools that strengthen the bulk/folder position first.

### Files and projects

- [x] Duplicate-file finder using size grouping + streaming SHA-256 verification
- [ ] Folder manifest generator
- [ ] File checksum generator/verifier
- [ ] Line-ending normalizer
- [ ] Text encoding normalizer/detector
- [ ] Bulk extension changer with dry-run

### Images

- [ ] EXIF/metadata inspector and remover
- [ ] SVG optimizer
- [ ] favicon/app-icon generator
- [ ] image metadata inspector
- [ ] bulk watermarking with preview

### Documents

- [ ] PDF merge
- [ ] PDF split/extract pages
- [ ] PDF metadata inspector/remover
- [ ] image → PDF batch builder

### Code and structured data

These are useful for discoverability, but should not distract from the bulk product identity:

- [ ] JSON formatter/validator/minifier
- [ ] YAML ↔ JSON converter
- [ ] CSV utilities
- [ ] Base64 encode/decode for files/text
- [ ] hash/checksum generator
- [ ] Regex tester
- [ ] JWT inspector
- [ ] UUID generator

## Phase 4 — Workflow recipes

A major long-term differentiator is allowing users to combine compatible bulk operations.

Examples:

- image folder → resize → convert WebP → compress → ZIP
- code folder → normalize line endings → minify → ZIP
- asset folder → rename → generate manifest → checksums

Planned capabilities:

- [ ] simple multi-step recipe builder
- [ ] validate compatible input/output types between steps
- [ ] save and export recipes
- [ ] recipe execution progress
- [ ] reusable CLI/API representation of the same workflow

## Privacy direction

- [ ] Label every tool visibly as **browser-local** or **server-processed**
- [x] Keep folder intelligence and dry-run metadata analysis client-side
- [x] Keep presets browser-local by default
- [ ] Move safe lightweight text/data utilities client-side where practical
- [ ] Add a privacy status indicator on every tool page
- [ ] Document temp-file lifecycle visibly in the product
- [ ] Keep self-hosting as the default recommendation for sensitive files

Do not make false "files never leave your device" claims for server-processed tools.

## Platform and automation

- [ ] Document stable HTTP/API usage for automation
- [ ] Improve the CLI to expose the same processors/presets
- [ ] Docker image and Docker Compose quick start
- [ ] Optional authenticated/team deployment mode
- [ ] Machine-readable tool registry endpoint suitable for integrations

## Scale and production architecture

Before horizontal scaling or high-volume public processing:

- [ ] move job state from process memory to a shared store such as Redis
- [ ] move expensive processors into isolated worker processes/containers
- [ ] add bounded worker concurrency/backpressure
- [ ] add persistent/streamed result storage
- [ ] add distributed observability/metrics
- [ ] add abuse controls appropriate to a public hosted service

These are not required for normal self-hosted/single-instance use.

## Community growth

- [ ] Maintain beginner-friendly `good first issue` tasks
- [ ] Add GitHub social-preview image
- [ ] Enable GitHub Discussions when community traffic justifies it
- [ ] Publish real use-case demos instead of generic star requests
- [ ] Share meaningful releases in developer communities without spam
- [ ] Recognize contributors in release notes

## How priorities are chosen

A proposal moves up when it has a strong combination of:

1. real developer demand
2. clear value for bulk/folder workflows
3. previewability and safety
4. manageable dependencies and maintenance burden
5. safe handling of untrusted input
6. testability
7. contributor interest

A high number of tools is not the goal. A smaller catalog of reliable tools with excellent bulk workflows is more valuable than dozens of fragile one-off utilities.
