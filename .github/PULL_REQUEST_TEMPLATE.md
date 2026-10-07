## What this changes

## Why

## Checklist
- [ ] `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` pass
- [ ] `stellar contract build` passes
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass
- [ ] A test fails if the change is undone (break the code on purpose and watch it fail)
- [ ] If behaviour changed: `spec/SPEC.md`, `spec/vectors`, the contract and the TypeScript model are all updated together
- [ ] Any documented claim this affects is updated, and rests on a test or a recorded run
- [ ] Linked issue, if one exists: Closes #
