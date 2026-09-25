#!/usr/bin/env bash
# bootstrap-node24.sh
#
# Install the exact Node runtime for the isolated content renderer.
#
# Authors:
#     Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

set -euo pipefail

version=v24.21.0
archive=node-v24.21.0-linux-x64.tar.xz
archive_sha=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
binary_sha=7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c
keyring_sha=610b8d249da3d5733f5a128def2dd0294dbbf5b5713e6ca2529db8db419dee00
destination=/opt/dw-node24

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    echo 'Node 24 bootstrap requires the pinned Linux x64 devcontainer' >&2
    exit 1
fi
if [[ -e "$destination" ]]; then
    [[ ! -L "$destination" && -f "$destination/bin/node" ]] || exit 1
    [[ "$("$destination/bin/node" --version)" == "$version" ]] || exit 1
    echo "$binary_sha  $destination/bin/node" | sha256sum -c -
    exit 0
fi

download_dir=$(mktemp -d /tmp/dw-node24.XXXXXXXX)
trap 'rm -rf "$download_dir"' EXIT
curl -fsSLo "$download_dir/nodejs-keyring.kbx" \
    https://github.com/nodejs/release-keys/raw/HEAD/gpg/pubring.kbx
echo "$keyring_sha  $download_dir/nodejs-keyring.kbx" | sha256sum -c -
curl -fsSLo "$download_dir/SHASUMS256.txt.asc" \
    "https://nodejs.org/dist/$version/SHASUMS256.txt.asc"
gpgv --keyring "$download_dir/nodejs-keyring.kbx" \
    --output "$download_dir/SHASUMS256.txt" "$download_dir/SHASUMS256.txt.asc"

signed_sha=$(awk -v archive="$archive" '$2 == archive { print $1 }' \
    "$download_dir/SHASUMS256.txt")
[[ "$signed_sha" == "$archive_sha" ]] || {
    echo 'Pinned Node archive differs from signed release list' >&2
    exit 1
}
curl -fsSLo "$download_dir/$archive" "https://nodejs.org/dist/$version/$archive"
echo "$archive_sha  $download_dir/$archive" | sha256sum -c -

staged_destination=$(mktemp -d /opt/dw-node24.XXXXXXXX)
trap 'rm -rf "$download_dir" "$staged_destination"' EXIT
tar -xJf "$download_dir/$archive" -C "$staged_destination" \
    --strip-components=1 --no-same-owner
echo "$binary_sha  $staged_destination/bin/node" | sha256sum -c -
"$staged_destination/bin/node" --version
chmod -R go-w "$staged_destination"
mv "$staged_destination" "$destination"
trap 'rm -rf "$download_dir"' EXIT
echo "Installed verified Node $version at $destination"
