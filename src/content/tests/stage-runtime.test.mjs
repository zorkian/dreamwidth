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
    // The staged root must remain traversable from an ordinary non-root user.
    fs.chmodSync(temporary, 0o755);
    fs.writeFileSync(artifact, '{"schema":1}\n');
    fs.mkdirSync(path.join(workerDist, 'live/render'), { recursive: true });
    fs.mkdirSync(contentDist);
    fs.writeFileSync(path.join(workerDist, 'live/render/worker.js'),
        "process.stdout.write(require('@dreamwidth/content').value + ':' + process.getuid());\n");
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
    const checkModes = directory => {
        const directoryStat = fs.lstatSync(directory);
        assert.equal(directoryStat.mode & 0o777, 0o555, directory);
        assert.equal(directoryStat.uid, process.getuid(), directory);
        for (const name of fs.readdirSync(directory)) {
            const filename = path.join(directory, name);
            const stat = fs.lstatSync(filename);
            if (stat.isDirectory()) checkModes(filename);
            else {
                assert.equal(stat.mode & 0o777, 0o444, filename);
                assert.equal(stat.uid, process.getuid(), filename);
            }
        }
    };
    checkModes(stageRoot);
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
    const workerArguments = ['/opt/dw-node24/bin/node', '--permission',
        '--no-addons', '--disable-proto=throw', '--max-old-space-size=128',
        `--allow-fs-read=${stageRoot}`, path.join(stageRoot, manifest.entryPath)];
    const workerOptions = { env: { LANG: 'C.UTF-8', TZ: 'UTC' }, cwd: stageRoot,
        encoding: 'utf8', timeout: 10000 };
    const worker = spawnSync(sandbox, workerArguments, workerOptions);
    assert.equal(worker.status, 0, worker.stderr || String(worker.error));
    assert.equal(worker.stdout, 'synthetic-closed-stage:0');
    const nonRoot = spawnSync('/usr/bin/setpriv', ['--reuid=65534', '--regid=65534',
        '--clear-groups', sandbox, ...workerArguments], workerOptions);
    assert.equal(nonRoot.status, 0, nonRoot.stderr || String(nonRoot.error));
    assert.equal(nonRoot.stdout, 'synthetic-closed-stage:65534');

    // Rebuilding an intact managed stage is allowed and deterministic.
    build();
    assert.equal(fileHash(path.join(stageRoot, 'manifest.json')),
        createHash('sha256').update(JSON.stringify(manifest, null, 2) + '\n').digest('hex'));
    assert.ok(!fs.readdirSync(temporary).some(name => name.includes('.runtime.old-')));

    // Build the same closed tree twice as an ordinary user. The old stage's
    // readonly directory permissions must not prevent its validated removal.
    const ordinary = path.join(temporary, 'ordinary');
    fs.mkdirSync(ordinary, { mode: 0o700 });
    fs.chownSync(ordinary, 65534, 65534);
    const ordinaryArtifact = path.join(ordinary, 'stock.json');
    fs.writeFileSync(ordinaryArtifact, '{"schema":1}\n');
    fs.chownSync(ordinaryArtifact, 65534, 65534);
    const ordinaryRoot = `${ordinaryArtifact}.runtime`;
    const buildOrdinary = () => spawnSync('/usr/bin/setpriv',
        ['--reuid=65534', '--regid=65534', '--clear-groups',
            '/opt/dw-node24/bin/node', '--input-type=module', '-e',
            `import {stageRuntime} from ${JSON.stringify(new URL('../tools/stage-runtime.mjs', import.meta.url).href)};
             stageRuntime(process.argv[1], {s2Dist:process.argv[2], contentDist:process.argv[3]});`,
            ordinaryArtifact, workerDist, contentDist],
        { encoding: 'utf8', timeout: 120000,
            env: { ...process.env, npm_config_cache: path.join(ordinary, 'npm-cache') } });
    for (let pass = 0; pass < 2; pass++) {
        const result = buildOrdinary();
        assert.equal(result.status, 0, result.stderr || String(result.error));
        const checkOrdinary = directory => {
            const stat = fs.lstatSync(directory);
            assert.equal(stat.uid, 65534, directory);
            assert.equal(stat.mode & 0o777, 0o555, directory);
            for (const name of fs.readdirSync(directory)) {
                const filename = path.join(directory, name);
                const child = fs.lstatSync(filename);
                if (child.isDirectory()) checkOrdinary(filename);
                else {
                    assert.equal(child.uid, 65534, filename);
                    assert.equal(child.mode & 0o777, 0o444, filename);
                }
            }
        };
        checkOrdinary(ordinaryRoot);
        assert.ok(!fs.readdirSync(ordinary).some(name => name.includes('.runtime.old-')));
    }

    // A member owned by another UID cannot be taken over during replacement.
    const syntheticPackage = path.join(stageRoot, 'app/package.json');
    fs.chownSync(syntheticPackage, 65534, 65534);
    assert.throws(build, /stage ownership or member type differs/);
    assert.equal(fs.lstatSync(syntheticPackage).uid, 65534);
    fs.chownSync(syntheticPackage, process.getuid(), process.getgid());

    // An unlisted file or symlink makes replacement fail without deletion.
    const extra = path.join(stageRoot, 'unlisted');
    fs.symlinkSync('/etc/passwd', extra);
    assert.throws(build, /symlink in closure/);
    assert.equal(fs.lstatSync(extra).isSymbolicLink(), true);
    console.log(JSON.stringify({ syntheticWorker: worker.stdout,
        nonRootWorker: nonRoot.stdout, directoryMode: '0555', fileMode: '0444',
        files: manifest.files.length, repeat: 'root and uid65534',
        tamperedOwnership: 'rejected', tamperedReplacement: 'rejected' }));
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
