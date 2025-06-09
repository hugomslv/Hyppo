# Time Manager by Hyppo

**Time Manager** is a Chrome extension designed to help you track and display your worked time on the `launchpad.wd.pnet.ch` platform. It injects custom scripts on this website to calculate your daily and weekly hours, show estimations of the end of your day and offers simple customization options.

## Loading the extension in Chrome

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** using the toggle in the top right corner.
3. Click **Load unpacked** and select this project directory.
4. The "Time Manager" icon will appear in the toolbar once loaded.

## Configuration popup

Clicking the extension icon opens a popup where you can configure:

- Daily work hours and working days per week.
- Interface language.
- Lunch break parameters.
- Which table rows to convert to days or remove.

All settings are saved in Chrome's synchronized storage so they are available across your signed‑in devices.

## Required permissions

The extension requests the following permissions:

- `tabs`, `scripting` and `storage` – used to read the active tab, inject scripts and store your configuration.
- Host permission for `https://launchpad.wd.pnet.ch/*` – only this domain is modified by the extension.

