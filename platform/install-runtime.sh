#!/usr/bin/env bash
set -euo pipefail
root=${1:?Pass an absolute private runtime directory}
[[ "$root" == /* ]] || exit 1
umask 077
mkdir -p "$root/downloads" "$root/native" "$root/electron"
cd "$root/downloads"
apt-get download xvfb xserver-common xauth x11-xkb-utils libxfont2 libxkbfile1 libasound2 libasound2-data libfontenc1
for archive in ./*.deb; do dpkg-deb -x "$archive" "$root/native"; done
# The packaged X server invokes this compiler by its standard absolute path.
if [[ ! -x /usr/bin/xkbcomp ]]; then
 docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  -v "$root/native/usr/bin:/source:ro" -v /usr/bin:/target \
  mcr.microsoft.com/dotnet/aspnet:10.0.12 sh -c 'test ! -e /target/xkbcomp && cp /source/xkbcomp /target/xkbcomp && chmod 755 /target/xkbcomp'
fi
version=44.7.0
curl --fail --location --retry 2 "https://github.com/electron/electron/releases/download/v$version/electron-v$version-linux-x64.zip" --output electron.zip
curl --fail --location --retry 2 "https://github.com/electron/electron/releases/download/v$version/SHASUMS256.txt" --output SHASUMS256.txt
hash=$(awk -v name="electron-v$version-linux-x64.zip" '$2 == name || $2 == "*" name {print $1}' SHASUMS256.txt)
[[ "$hash" =~ ^[a-f0-9]{64}$ ]] || exit 1
printf '%s  electron.zip\n' "$hash" | sha256sum --check
unzip -q electron.zip -d "$root/electron"
chmod +x "$root/electron/electron" "$root/native/usr/bin/Xvfb" "$root/native/usr/bin/xauth"
rm electron.zip
