// manifest.test.ts
//
// Exercise runtime-manifest validation without executing synthetic worker code.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
    readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {verifyRuntime} from "../render/manifest";
import type {RenderWorkerManifest} from "@dreamwidth/content/contracts";

function hash(value: Buffer | string): string {return createHash("sha256").update(value).digest("hex");}
function modes(path: string, directories: number, files: number): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
        chmodSync(path, directories);
        for (const name of readdirSync(path)) modes(join(path, name), directories, files);
    } else chmodSync(path, files);
}
function fixture(run: (artifact: string, root: string, manifest: RenderWorkerManifest) => void): void {
    const temporary = mkdtempSync(join(tmpdir(), "dw-render-manifest-test-"));
    const artifact = join(temporary, "stock.json");
    const root = artifact + ".runtime";
    const entryPath = "app/dist/live/render/worker.js";
    const code = "// Synthetic manifest admission fixture; never executed.\n";
    writeFileSync(artifact, "Synthetic artifact for independent manifest checks\n");
    mkdirSync(dirname(join(root, entryPath)), {recursive: true});
    writeFileSync(join(root, entryPath), code);
    const manifest: RenderWorkerManifest = {schema: 1, artifactSha256: hash(readFileSync(artifact)),
        contentLockSha256: hash(readFileSync(resolve(__dirname, "../../../../../../content/package-lock.json"))),
        nodeVersion: "24.21.0", nodeExecutable: "/opt/dw-node24/bin/node", entryPath,
        files: [{path: entryPath, sha256: hash(code), bytes: Buffer.byteLength(code)}]};
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    modes(root, 0o555, 0o444);
    try {run(artifact, root, manifest);} finally {
        modes(root, 0o755, 0o644);
        rmSync(temporary, {recursive: true, force: true});
    }
}
function rewrite(root: string, value: unknown): void {
    const path = join(root, "manifest.json");
    chmodSync(path, 0o644);
    writeFileSync(path, JSON.stringify(value));
    chmodSync(path, 0o444);
}

test("manifest validates a closed fixture and derives the root rather than accepting caller authority", () => {
    fixture((artifact, root) => {
        assert.deepEqual(verifyRuntime(artifact), {root, entry: join(root, "app/dist/live/render/worker.js"),
            node: "/opt/dw-node24/bin/node"});
    });
});

test("manifest rejects non-traversable and writable directories even when root could read them", () => {
    for (const mode of [0o444, 0o755, 0o777]) fixture((artifact, root) => {
        chmodSync(join(root, "app/dist"), mode);
        assert.throws(() => verifyRuntime(artifact));
    });
});

test("manifest rejects unlisted files, escaped symlinks, native addons and duplicate inventory", () => {
    fixture((artifact, root) => {
        modes(root, 0o755, 0o444);
        writeFileSync(join(root, "app/dist/live/render/credential.json"), "SYNTHETIC_SECRET");
        modes(root, 0o555, 0o444);
        assert.throws(() => verifyRuntime(artifact));
    });
    fixture((artifact, root) => {
        modes(root, 0o755, 0o444);
        symlinkSync(artifact, join(root, "app/dist/live/render/escape"));
        modes(root, 0o555, 0o444);
        assert.throws(() => verifyRuntime(artifact));
    });
    fixture((artifact, root, manifest) => {
        rewrite(root, {...manifest, files: [...manifest.files, manifest.files[0]]});
        assert.throws(() => verifyRuntime(artifact));
    });
    fixture((artifact, root, manifest) => {
        rewrite(root, {...manifest, files: [{...manifest.files[0], path: "app/node_modules/native/addon.node"}]});
        assert.throws(() => verifyRuntime(artifact));
    });
});

test("manifest rejects changed bytes, artifact/lock mismatch and self-authorized executables", () => {
    fixture((artifact, root) => {
        const entry = join(root, "app/dist/live/render/worker.js");
        chmodSync(entry, 0o644);
        writeFileSync(entry, "MODIFIED");
        chmodSync(entry, 0o444);
        assert.throws(() => verifyRuntime(artifact));
    });
    for (const change of [{artifactSha256: "0".repeat(64)}, {contentLockSha256: "0".repeat(64)},
        {nodeExecutable: "/tmp/untrusted-node"}, {nodeVersion: "20.20.2"},
        {entryPath: "../../outside.js"}, {root: "/tmp/other-runtime"}]) {
        fixture((artifact, root, manifest) => {
            rewrite(root, {...manifest, ...change});
            assert.throws(() => verifyRuntime(artifact));
        });
    }
});
