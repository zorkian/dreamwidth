// stage-runtime.test.mjs
//
// Qualify closed-root staging mechanics with synthetic compiled entry modules.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageRuntime } from '../tools/stage-runtime.mjs';

const sandbox = process.argv[2];
assert.ok(path.isAbsolute(sandbox),
    'usage: node tests/stage-runtime.test.mjs <existing-sandbox>');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-stage-mechanics-'));
const artifact = path.join(temporary, 'stock.json');
const workerDist = path.join(temporary, 'compiled-s2');
const contentDist = path.join(temporary, 'compiled-content');
const stageRoot = `${artifact}.runtime`;
const fileHash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

try {
    fs.writeFileSync(artifact, '{"schema":1}\n');
    fs.mkdirSync(path.join(workerDist, 'live/render'), { recursive: true });
    fs.mkdirSync(contentDist);
    fs.writeFileSync(path.join(workerDist, 'live/render/worker.js'),
        "process.stdout.write(require('@dreamwidth/content').value);\n");
    fs.writeFileSync(path.join(contentDist, 'index.js'),
        "exports.value = 'synthetic-closed-stage';\n");
    fs.writeFileSync(path.join(contentDist, 'contracts.js'), '"use strict";\n');

    const build = () => stageRuntime(artifact, { s2Dist: workerDist, contentDist });
    build();
    const manifest = JSON.parse(fs.readFileSync(path.join(stageRoot, 'manifest.json')));
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.artifactSha256, fileHash(artifact));
    assert.equal(manifest.entryPath, 'app/dist/live/render/worker.js');
    assert.equal(manifest.nodeVersion, '24.21.0');
    assert.equal(manifest.nodeExecutable, '/opt/dw-node24/bin/node');
    assert.equal(manifest.contentLockSha256,
        fileHash(path.resolve('package-lock.json')));
    assert.ok(manifest.files.length > 30);
    const names = manifest.files.map(file => file.path);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(names, [...names].sort());
    for (const file of manifest.files) {
        assert.ok(!path.isAbsolute(file.path) && !file.path.startsWith('../'));
        const filename = path.join(stageRoot, file.path);
        const stat = fs.lstatSync(filename);
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o022));
        assert.equal(file.sha256, fileHash(filename));
        assert.equal(file.bytes, stat.size);
        assert.ok(!file.path.endsWith('.node'));
        assert.ok(!file.path.includes('playwright') && !file.path.includes('/canvas/'));
    }
    const worker = spawnSync(sandbox, ['/opt/dw-node24/bin/node', '--permission',
        '--no-addons', '--disable-proto=throw', '--max-old-space-size=128',
        `--allow-fs-read=${stageRoot}`, path.join(stageRoot, manifest.entryPath)],
        { env: { LANG: 'C.UTF-8', TZ: 'UTC' }, cwd: stageRoot,
            encoding: 'utf8', timeout: 10000 });
    assert.equal(worker.status, 0, worker.stderr || String(worker.error));
    assert.equal(worker.stdout, 'synthetic-closed-stage');

    // Rebuilding an intact managed stage is allowed and deterministic.
    build();
    assert.equal(fileHash(path.join(stageRoot, 'manifest.json')),
        createHash('sha256').update(JSON.stringify(manifest, null, 2) + '\n').digest('hex'));

    // An unlisted file or symlink makes replacement fail without deletion.
    const extra = path.join(stageRoot, 'unlisted');
    fs.symlinkSync('/etc/passwd', extra);
    assert.throws(build, /symlink in closure/);
    assert.equal(fs.lstatSync(extra).isSymbolicLink(), true);
    console.log(JSON.stringify({ syntheticWorker: worker.stdout,
        files: manifest.files.length, repeat: 'identical', tamperedReplacement: 'rejected' }));
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
