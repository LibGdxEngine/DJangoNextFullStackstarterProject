## Handoff: consensus planning → team-exec
- Decided: hosted CI, private GHCR digest pairs, one isolated test runtime, fixed root-owned run-ID deploy protocol.
- Rejected: blue-green initially due RAM; unrestricted Docker SSH; uploaded root scripts.
- Risks: shared Caddy single-file mount, migration compatibility, frontend critical advisory, source snapshot includes temporary QA route to exclude.
- Files: .omc/plans/ralplan-cicd-vps.md; execution in /home/ahmed/Documents/Mobser-cicd.
- Remaining: runtime and workflows, controller tests, host bootstrap, real CI release, smoke/persistence/rollback and existing-site verification.
