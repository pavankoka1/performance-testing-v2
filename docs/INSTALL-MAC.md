# Installing PerfTrace on macOS

## For end users (opening the app)

macOS Gatekeeper blocks apps that are not signed by an Apple Developer. If you see a message like:

- "PerfTrace cannot be opened because the developer cannot be verified"
- "PerfTrace has been blocked for your protection"
- macOS asking you to go to **Privacy & Security** to grant permission

You can still run PerfTrace. Use one of these methods:

### Method 1: Right-click → Open (recommended)

1. **Right-click** (or Control+click) on **PerfTrace**
2. Choose **Open** from the menu
3. In the dialog, click **Open**

macOS remembers your choice. Next time you can double-click the app normally.

### Method 2: Privacy & Security settings

1. Try to open PerfTrace (double-click)
2. When macOS blocks it, open **System Settings** (or **System Preferences** on older macOS)
3. Go to **Privacy & Security**
4. Scroll down — you should see "PerfTrace was blocked..."
5. Click **Open Anyway**
6. Confirm by clicking **Open** in the dialog

### Method 3: Remove quarantine flag (advanced)

If you downloaded the app as a `.zip` or `.dmg`, macOS adds a quarantine flag. You can remove it in Terminal:

```bash
# For .app in a folder (e.g. after extracting .zip):
xattr -cr /path/to/PerfTrace.app

# Example if PerfTrace.app is on your Desktop:
xattr -cr ~/Desktop/PerfTrace.app
```

Then try opening the app again. You may still need **Right-click → Open** the first time.

---

## For distributors (code signing & notarization)

To build a version that installs like normal commercial apps — **no Gatekeeper warning** — you need:

- **Apple Developer Program** membership ($99/year)
- **Developer ID Application** certificate
- **Notarization** (Apple verifies the app)

### 1. Get Apple certificates

1. Join the [Apple Developer Program](https://developer.apple.com/programs/).
2. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list):
   - Create a **Developer ID Application** certificate
   - Install it in Keychain Access (Xcode can help with this)
3. Get your **Team ID** from [Apple Developer Membership](https://developer.apple.com/account/#/membership).

### 2. Create an app-specific password

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Generate a new password for "PerfTrace" or "Electron notarization"
3. Save this password — you'll use it as `APPLE_PASSWORD` (it’s not your normal Apple ID password).

### 3. Build with signing

Set environment variables and run the macOS build:

```bash
export APPLE_ID="your-apple-id@email.com"
export APPLE_TEAM_ID="XXXXXXXXXX"   # 10-character Team ID
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App-specific password

npm run electron:make:mac
```

The build will:

1. Package PerfTrace
2. Sign it with your Developer ID
3. Submit it to Apple for notarization
4. Staple the notarization ticket to the app

Output: `out/make/PerfTrace-x.x.x-universal.dmg` (and `.zip`). Users can install it like any other app.

### 4. Verify the build

```bash
# Check code signature
codesign -dv --verbose=4 out/make/PerfTrace\ X.X.X-universal.dmg

# Check notarization (after mounting the DMG)
spctl -a -vv -t install /Volumes/PerfTrace/PerfTrace.app
# Should show: "accepted" and "source=Notarized Developer ID"
```

---

## Summary

| Who             | Goal                  | What to do                                                     |
| --------------- | --------------------- | -------------------------------------------------------------- |
| **End user**    | Run PerfTrace         | Right-click → Open (first launch only)                         |
| **Distributor** | No Gatekeeper warning | Use Apple Developer account + `APPLE_*` env vars when building |
