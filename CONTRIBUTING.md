# Contributing

Thank you for improving Inklet.

1. Open an Issue describing the behavior, scope and platform before a large change.
2. Keep Windows-specific and macOS-specific host behavior separated from the shared editor core.
3. Do not add network dependencies to document editing, preview or export paths.
4. Add focused tests for file safety, recovery, IPC and user-visible behavior.
5. Run the commands below before opening a pull request.

```sh
npm ci --prefix inklet/app
npm ci --prefix inklet-mac
cd inklet-mac
npm run build:web
npm test
npm run test:desktop
```

Contributions intentionally submitted for inclusion are licensed under Apache License 2.0 as described in Section 5 of that license. Do not submit code or assets you do not have the right to contribute.
