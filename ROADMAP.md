# DevToolkit Roadmap

DevToolkit's goal is to become a trusted open-source toolbox for everyday developer file-processing work, with excellent single-file, multi-file, and folder/bulk workflows.

The roadmap is directional, not a promise of dates. Priorities can change based on security, contributor interest, real-world usage, and maintenance cost.

## Now — Open-source foundation

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

## Next — Make the existing tools excellent

- [ ] Improve accessibility testing and keyboard coverage
- [ ] Add richer per-tool validation/error messages
- [ ] Improve result metadata consistently across processors
- [ ] Add before/after previews where they provide real value
- [ ] Expand file format test fixtures
- [ ] Improve mobile/tablet workflow ergonomics
- [ ] Add documented local Docker deployment option
- [ ] Establish a stable versioning/release process

## Tool catalog growth

Potential tools should solve real developer problems and fit the shared bulk workflow.

Candidates include:

### Images
- [ ] EXIF/metadata inspector and remover
- [ ] SVG optimizer
- [ ] favicon/app-icon generator
- [ ] image format/metadata inspector

### Code & data
- [ ] JSON formatter/validator/minifier
- [ ] YAML ↔ JSON converter
- [ ] CSV utilities
- [ ] Base64 encode/decode for files/text
- [ ] hash/checksum generator
- [ ] line ending / encoding normalizer

### Files
- [ ] duplicate-file finder
- [ ] archive inspection/extraction tools with strict safety controls
- [ ] folder manifest generator
- [ ] file checksum comparison

### Documents
- [ ] PDF merge/split/metadata utilities where processor isolation is adequate

Open a **New tool proposal** issue before implementing a large new processor.

## Scale and production architecture

Before horizontal scaling or high-volume public processing:

- [ ] move job state from process memory to a shared store such as Redis
- [ ] move expensive processors into isolated worker processes/containers
- [ ] add bounded worker concurrency/backpressure
- [ ] add persistent/streamed result storage instead of retaining large response blobs in browser memory
- [ ] add distributed observability/metrics
- [ ] add abuse controls appropriate to a public hosted service

These are not required for normal self-hosted/single-instance use.

## Community growth

- [ ] Create a first public release
- [ ] Maintain beginner-friendly `good first issue` tasks
- [ ] Publish screenshots/GIF demo in README
- [ ] Add a GitHub social-preview image
- [ ] Enable GitHub Discussions when community traffic justifies it
- [ ] Share meaningful releases in developer communities without spam
- [ ] Recognize contributors in release notes

## How priorities are chosen

A proposal moves up when it has a strong combination of:

1. real developer demand
2. clear value for bulk workflows
3. manageable dependencies and maintenance burden
4. safe handling of untrusted input
5. testability
6. contributor interest

A high number of proposed features is not the goal. A smaller catalog of reliable tools is better than dozens of fragile utilities.
