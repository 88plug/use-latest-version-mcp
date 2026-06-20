## Summary

Describe what this PR changes and why.

## Validation

- [ ] `npm run build`
- [ ] Node test suites pass (`for t in test-*.js; do node "$t"; done`, network-light)
- [ ] `bun test test-upgrade-applier.test.js test-upgrade-validator.test.js`
- [ ] `python .ci/validate_plugin.py .`
- [ ] `mkdocs build --strict` (if docs changed)

## Documentation

- [ ] Updated `docs/` if user-facing behavior changed
- [ ] No repo-local absolute paths were introduced

## Notes

Call out assumptions, follow-up work, or release implications.
