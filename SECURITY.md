# Security Policy

## Supported version

Security fixes are developed against the latest source on `main`. Published releases, once available, will state their support status in their release notes.

## Reporting a vulnerability

Use GitHub's **Security > Advisories > Report a vulnerability** flow when private vulnerability reporting is enabled. If that option is unavailable, open a minimal Issue asking the maintainer to provide a private reporting channel; do not include exploit details, tokens, certificates, personal documents or recovery data in the Issue.

Reports should include the affected version, operating system, reproduction boundary and expected impact. Please allow the maintainer time to confirm and prepare a coordinated fix before public disclosure.

## Product boundaries

Inklet processes local Markdown and image files. Do not attach private user documents to public reports. Signing certificates, notarization API keys and passwords must never be committed to the repository or pasted into Issues, Discussions or build logs.
