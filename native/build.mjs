import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {cleanNativeBundle,verifyNativeBundle} from '../scripts/native-bundle.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = path.join(root, 'native', 'ThoughtSpaceCalendarBridge.app');
const contents = path.join(app, 'Contents');
mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.thoughtspace.calendar.bridge</string>
<key>CFBundleName</key><string>ThoughtSpace 日历联动</string>
<key>CFBundleExecutable</key><string>calendar-bridge</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSCalendarsUsageDescription</key><string>在 ThoughtSpace 大日历中查看、新建和修改您选择的苹果日历日程。</string>
<key>NSCalendarsFullAccessUsageDescription</key><string>在 ThoughtSpace 大日历中查看、新建和修改您选择的苹果日历日程。</string>
</dict></plist>`);
const binaries = [];
for (const arch of ['arm64', 'x86_64']) {
  const binary = path.join(root, 'native', `bridge-${arch}`);
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos14.0`,
    path.join(root, 'native', 'CalendarBridge.swift'), '-o', binary], { stdio: 'inherit' });
  binaries.push(binary);
}
execFileSync('/usr/bin/lipo', ['-create', ...binaries, '-output', path.join(contents, 'MacOS', 'calendar-bridge')]);
cleanNativeBundle(app);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'app.thoughtspace.calendar.bridge', app], { stdio: 'inherit' });
verifyNativeBundle(app);
console.log(app);
