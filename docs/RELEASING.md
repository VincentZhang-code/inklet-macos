# Releasing Inklet for macOS

This checklist describes distribution outside the Mac App Store.

## Prerequisites

1. Join the Apple Developer Program. An individual membership displays the member's legal name and currently costs USD 99 per year.
2. Enable two-factor authentication on the Apple Account.
3. As the Account Holder, create a **Developer ID Application** certificate and install it in a trusted Mac keychain.
4. Replace the development bundle identifier `local.inklet.desktop` with a stable identifier controlled by the publisher.
5. Configure notarization credentials with `xcrun notarytool store-credentials` or an App Store Connect API key.

Never commit certificate files, passwords, API private keys or notary profiles. Store CI credentials in protected GitHub environments and encrypted repository secrets.

## Build, sign and notarize

1. Build and test each architecture on macOS.
2. Sign all nested code and the application with Developer ID, hardened runtime and appropriate entitlements.
3. Verify the signature:

   ```sh
   codesign --verify --deep --strict --verbose=2 Inklet.app
   spctl --assess --type execute --verbose=4 Inklet.app
   ```

4. Create a ZIP with `ditto`, submit it with `xcrun notarytool submit --wait`, and review the notarization log.
5. Staple and validate the ticket on the application, then create the final ZIP again:

   ```sh
   xcrun stapler staple Inklet.app
   xcrun stapler validate Inklet.app
   ditto -c -k --sequesterRsrc --keepParent Inklet.app Inklet-mac.zip
   ```

6. Download the final asset on a separate Mac and verify the normal Finder/Gatekeeper launch path, file association, save/export, Chinese input method and multi-window behavior.

## GitHub Release

1. Tag the exact verified commit, for example `v0.11.0`.
2. Create a GitHub Release from that tag.
3. Upload the notarized Apple Silicon and Intel ZIP files plus `SHA256SUMS.txt`.
4. State the minimum macOS version, architecture choices, test scope, known limitations and license.
5. Do not attach ad-hoc or unnotarized builds to a public stable release.
