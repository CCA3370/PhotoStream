# Viewer UX verification scope

This branch consolidates the public gallery UX and face-search controls before CI verification.

- compact school-only gallery header and one-line copyright footer
- denser responsive 4:3 gallery grid with portrait-safe containment
- unified find-photo dialog/sheet for number, attributes, and face search
- async face search keeps an explicit in-progress state until the provider task is terminal
- simplified photo lightbox with like/download actions in the bottom toolbar
- compact password-unlock flow and mobile-friendly touch targets
- album-level face switch is the sole product enablement control; infrastructure/index states remain runtime status only
- complaint/deletion contact content is removed from runtime contracts, UI, API serialization, and the database schema; migration 0018 drops the legacy column

CI results are authoritative for lint, typecheck, tests, and build.
