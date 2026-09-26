// main-startup.test.ts
//
// Standalone executable failure and private-config disclosure checks.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("standalone main rejects invalid startup without exposing input", () => {
    const main = path.resolve(__dirname, "../live/server/main.js");
    const dir = mkdtempSync(path.join(os.tmpdir(), "s6-main-negative-"));
    try {
        const file = path.join(dir, "private.json");
        const secret = "must-never-appear-credential";
        writeFileSync(file, JSON.stringify({password: secret}), {mode: 0o600});
        const link = path.join(dir, "link.json");
        symlinkSync(file, link);
        for (const args of [[], ["--config", file], ["--config", link],
            ["--config", path.join(dir, secret)], ["--password", secret]]) {
            const result = spawnSync(process.execPath, [main, ...args],
                {encoding: "utf8", timeout: 5000});
            assert.equal(result.status, 1);
            assert.equal(result.error, undefined);
            assert.equal(result.stdout, "");
            assert.ok(!result.stderr.includes(secret));
            assert.ok(!result.stderr.includes(dir));
            assert.match(result.stderr, /^(Usage: main --config <private-json-file>|Invalid private startup configuration|Cannot read private startup config; check file, permissions and JSON)\n$/);
        }
    } finally { rmSync(dir, {recursive: true, force: true}); }
});
