# Privacy Policy — MFA Vault

_Last updated: 2026-05-09_

## Overview

MFA Vault is a browser extension that generates TOTP/MFA codes locally on your device and auto-fills them into login fields on websites you configure.

## Data collected

MFA Vault stores the following data **exclusively on your device** using `chrome.storage.local`:

- TOTP secrets (the keys used to generate MFA codes)
- Account names and folder names you create
- Site-specific auto-fill rules (URL patterns and CSS selectors)

## Data we do NOT collect

- No data is transmitted to any external server
- No analytics, telemetry, or usage tracking
- No account required
- No cloud sync

## Permissions used

| Permission | Purpose |
|------------|---------|
| `storage` | Save your accounts and settings locally on your device |
| `activeTab` | Read the current tab URL to match auto-fill rules |
| `scripting` | Inject a local function to fill the MFA code into the login field |
| `tabs` | Query the active tab URL at the moment you click a code |
| `host_permissions: <all_urls>` | Required because auto-fill targets are chosen by the user at runtime |

## Third parties

MFA Vault has no third-party dependencies and shares no data with any third party.

## Contact

For questions or concerns, open an issue at:  
https://github.com/nerigleston/mfa-vault/issues
