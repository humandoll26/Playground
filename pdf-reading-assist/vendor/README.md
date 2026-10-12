# PDF.js

Vendored PDF.js 6.4.299 (official stable release, checked 2026-10-12).

- `pdf.min.mjs`: ES module browser library
- `pdf.worker.min.mjs`: matching ES module parsing worker
- `cmaps/`, `standard_fonts/`, `wasm/`: local rendering resources and licenses
- `LICENSE`: upstream Apache License 2.0 text

Upstream project: https://github.com/mozilla/pdf.js

Official distribution: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
Release: https://github.com/mozilla/pdf.js/releases/tag/v6.4.299
Files are copied unchanged from `build/` in the npm tarball (no minified patches).
SHA-256:
- pdf.min.mjs: `57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2`
- pdf.worker.min.mjs: `9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18`
The unused QuickJS scripting runtime and sandbox/viewer are not bundled.

Security: CVE-2024-4367 was fixed in 4.2.67; CVE-2026-16633
(GHSA-hq66-cqwq-w95j) was fixed in 6.2.108. This version includes both fixes.
`app.js` uses only getDocument, canvas rendering and text extraction. It does
not instantiate PDFViewer, PDFScriptingManager or annotation/action handlers.
`enableScripting` is a viewer policy, not a getDocument option; adding it to
getDocument would not disable scripting. The requested `isEvalSupported:false`
is retained explicitly, but v6 removed that getDocument option/eval path, so
the effective protections are the patched version and no scripting integration.

Advisories:
- https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq
- https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j
