## What does this change?

<!-- Explain the problem and the solution. Keep it concrete. -->

## Type of change

- [ ] Bug fix
- [ ] New tool
- [ ] Existing tool improvement
- [ ] UI / accessibility
- [ ] Security / hardening
- [ ] Performance
- [ ] Tests
- [ ] Documentation
- [ ] Deployment / infrastructure

## How was it tested?

<!-- Include commands, scenarios, and relevant manual testing. -->

```bash
cd php-protector
npm test
```

## Processing / security review

For changes involving uploaded files or processors:

- [ ] User-controlled paths are validated before filesystem/archive use.
- [ ] User input is not interpolated into shell commands.
- [ ] CPU, memory, dimensions, file sizes, and/or timeouts are bounded where relevant.
- [ ] Temporary files are cleaned on success and failure paths.
- [ ] Errors do not expose sensitive production details.
- [ ] Cancellation/job lifecycle behavior is preserved where relevant.

If none apply, explain why:

<!-- N/A reason -->

## UI review

For user-visible changes:

- [ ] I reused shared DevToolkit components/workflows instead of duplicating them.
- [ ] Keyboard and accessible labels/states were considered.
- [ ] Loading, failure, and result behavior are clear.
- [ ] I included screenshots or a short recording for meaningful visual changes.

## Checklist

- [ ] I read `CONTRIBUTING.md`.
- [ ] I searched for an existing issue/PR covering the same change.
- [ ] I added or updated tests for behavioral changes.
- [ ] `npm test` passes locally.
- [ ] I updated documentation when behavior or configuration changed.
- [ ] This PR contains no secrets, private files, generated uploads, or unrelated changes.

## Related issue

Closes #
