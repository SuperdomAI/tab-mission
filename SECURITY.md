# Security Policy

## Supported versions

Security fixes are applied to the latest release. Upgrade to the newest version to get them — we do not maintain security patches for older releases.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Report privately:

- Use GitHub's **private vulnerability reporting** on the repository: <https://github.com/SuperdomAI/tab-mission/security/advisories/new>
- Or email `security@superdom.ai` with a description, affected versions, and a minimal reproduction if possible.

We aim to acknowledge reports within 5 business days and will coordinate a fix and public disclosure timeline with you. Please keep the issue private until a fix is released.

## Security model

This extension is designed around a strict local-first privacy model:

- **No backend, no telemetry.** All tab, session, and analytics data lives in `chrome.storage.local` / `chrome.storage.sync` on the user's machine. There are no analytics SDKs and no external network calls by default.
- **Optional local AI only.** The sole outbound-capable feature is the Ollama integration (`localhost:11434` / `127.0.0.1:11434`). It is off by default, requires optional host permissions that the user grants at opt-in, is restricted by the manifest CSP, and can be revoked at any time.
- **Minimal permissions.** The manifest requests only what the features need (`tabs`, `windows`, `storage`, `idle`, `alarms`, `tabGroups`, `favicon`, `declarativeNetRequestWithHostAccess`). Contributions that add permissions or network calls require strong justification (see CONTRIBUTING.md).
- **One-way data flow.** The background service worker is the only writer of tab data; the UI is a read-only mirror of `chrome.storage`.

## Dependency hygiene

We aim to keep dependencies current and audited. Maintainers run `npm audit` before releases. If you find a vulnerability in a dependency, report it through the channels above rather than opening a public issue.

## Scope

This policy covers the code in this repository. It does not cover third-party extensions, Chrome itself, or your local Ollama installation.