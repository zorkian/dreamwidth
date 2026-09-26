// stage-runtime.mjs
//
// Build the closed, artifact-relative runtime for one stock S2 render worker.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeVersion = '24.21.0';
const nodeDigest = '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c';
const entryPath = 'app/dist/live/render/worker.js';
const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s2Root = path.resolve(contentRoot, '../s2/target/javascript');
const s2Dist = path.join(s2Root, 'dist');
const allowedBuiltins = new Set(builtinModules.map(name => `node:${name}`));

function fail(message) {
    throw new Error(`Runtime staging refused: ${message}`);
}

function digest(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function fileDigest(filename) {
    return digest(fs.readFileSync(filename));
}

function mustRegular(filename) {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        fail(`not a regular file: ${filename}`);
    }
    return stat;
}

function checkNode() {
    const executable = '/opt/dw-node24/bin/node';
    if (process.version !== `v${nodeVersion}` || process.execPath !== executable) {
        fail(`run with ${executable} v${nodeVersion}`);
    }
    mustRegular(executable);
    const executableStat = fs.lstatSync(executable);
    if (executableStat.uid !== 0 || (executableStat.mode & 0o022)) {
        fail('pinned Node executable ownership or mode changed');
    }
    if (fileDigest(executable) !== nodeDigest) fail('pinned Node executable digest changed');
    return executable;
}

function collectModules(sourceRoot, entry, allowedPackages) {
    const todo = [entry];
    const seen = new Set();
    while (todo.length) {
        const relative = todo.pop();
        if (seen.has(relative)) continue;
        if (!relative || relative.startsWith('../') || path.posix.isAbsolute(relative)
            || !relative.endsWith('.js')) fail('invalid compiled module path');
        const source = path.join(sourceRoot, relative);
        mustRegular(source);
        const code = fs.readFileSync(source, 'utf8');
        const imports = [...code.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
        const residual = code.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, '');
        if (/\brequire\s*\(/.test(residual)) fail(`dynamic require in ${relative}`);
        for (const match of imports) {
            const request = match[2];
            if (request.startsWith('./') || request.startsWith('../')) {
                const next = path.posix.normalize(path.posix.join(path.posix.dirname(relative),
                    request.endsWith('.js') ? request : `${request}.js`));
                if (next.startsWith('../') || path.posix.isAbsolute(next)) {
                    fail(`compiled import escapes its dist: ${relative}: ${request}`);
                }
                todo.push(next);
            } else if (!allowedBuiltins.has(request) && !allowedPackages.has(request)) {
                fail(`unexpected worker dependency ${request} in ${relative}`);
            }
        }
        seen.add(relative);
    }
    return [...seen].sort();
}

function visit(root, relative = '', files = []) {
    const names = fs.readdirSync(path.join(root, relative)).sort();
    for (const name of names) {
        const child = path.posix.join(relative, name);
        const filename = path.join(root, child);
        const stat = fs.lstatSync(filename);
        if (stat.isSymbolicLink()) fail(`symlink in closure: ${child}`);
        if (stat.isDirectory()) {
            if (stat.mode & 0o022) fail(`writable directory in closure: ${child}`);
            visit(root, child, files);
        } else if (stat.isFile()) {
            if ((stat.mode & 0o022) || child.endsWith('.node')) {
                fail(`writable or native addon in closure: ${child}`);
            }
            files.push({ path: child, sha256: fileDigest(filename), bytes: stat.size });
        } else {
            fail(`non-regular closure member: ${child}`);
        }
    }
    return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function validatePreviousStage(root) {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o022)) {
        fail('existing stage is not a readonly managed directory');
    }
    const manifestFile = path.join(root, 'manifest.json');
    mustRegular(manifestFile);
    if (fs.lstatSync(manifestFile).mode & 0o022) {
        fail('existing manifest is writable by group or others');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.schema !== 1 || manifest.entryPath !== entryPath ||
        manifest.nodeExecutable !== '/opt/dw-node24/bin/node' ||
        !Array.isArray(manifest.files)) {
        fail('existing stage does not have the pinned manifest shape');
    }
    const actualFiles = visit(root).filter(file => file.path !== 'manifest.json');
    if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files) ||
        !actualFiles.some(file => file.path === entryPath) ||
        !actualFiles.some(file =>
            file.path === 'app/node_modules/@dreamwidth/content/dist/index.js')) {
        fail('existing stage inventory differs from its manifest');
    }
    assertOwner(root);
}

function assertOwner(root) {
    const expected = process.getuid();
    const walk = filename => {
        const stat = fs.lstatSync(filename);
        if (stat.uid !== expected || stat.isSymbolicLink() ||
            (!stat.isDirectory() && !stat.isFile()) ||
            (stat.mode & 0o777) !== (stat.isDirectory() ? 0o555 : 0o444)) {
            fail(`stage ownership or member type differs: ${filename}`);
        }
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(filename)) walk(path.join(filename, name));
        }
    };
    walk(root);
}

function removeOwnedTree(root, privateTemp = false) {
    if (!fs.existsSync(root)) return;
    // A previous stage has passed full inventory and UID validation. npm may
    // chown files within this invocation's private temp tree before failing;
    // that tree has a separately checked owned root and no published identity.
    const prepare = directory => {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() ||
            (!privateTemp && stat.uid !== process.getuid())) {
            fail(`cannot remove unowned stage directory: ${directory}`);
        }
        fs.chmodSync(directory, 0o700);
        for (const name of fs.readdirSync(directory)) {
            const filename = path.join(directory, name);
            const child = fs.lstatSync(filename);
            if (!privateTemp && (child.uid !== process.getuid() || child.isSymbolicLink())) {
                fail(`cannot remove unowned stage member: ${filename}`);
            }
            if (child.isDirectory()) prepare(filename);
            else if (!child.isFile() && !(privateTemp && child.isSymbolicLink())) {
                fail(`cannot remove non-file stage member: ${filename}`);
            }
        }
    };
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() ||
        rootStat.uid !== process.getuid()) {
        fail(`cannot remove unowned stage root: ${root}`);
    }
    prepare(root);
    fs.rmSync(root, { recursive: true, force: true });
}

function removeNpmMetadata(app) {
    fs.rmSync(path.join(app, 'node_modules/.bin'), { recursive: true, force: true });
    fs.rmSync(path.join(app, 'node_modules/.package-lock.json'), { force: true });
    for (const scope of ['@types', '@playwright']) {
        const directory = path.join(app, 'node_modules', scope);
        if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
            fs.rmdirSync(directory);
        }
    }
    fs.rmSync(path.join(app, 'package-lock.json'));
    // npm may rewrite ownership of the input package inode. This output file
    // is synthetic and belongs to the staging process, so create a fresh inode.
    fs.rmSync(path.join(app, 'package.json'));
    fs.writeFileSync(path.join(app, 'package.json'),
        JSON.stringify({ name: 'dreamwidth-content-render-worker', private: true,
            type: 'commonjs' }) + '\n');
}

export function stageRuntime(artifact, sources = {}) {
    // The CLI supplies no source overrides. Synthetic source trees are used
    // only by the closed-stage mechanics test before the real worker lands.
    const workerDist = sources.s2Dist || s2Dist;
    const contentDist = sources.contentDist || path.join(contentRoot, 'dist');
    const nodeExecutable = checkNode();
    if (!path.isAbsolute(artifact)) fail('artifact path must be absolute');
    mustRegular(artifact);
    const lock = path.join(contentRoot, 'package-lock.json');
    const packageJson = path.join(contentRoot, 'package.json');
    mustRegular(lock);
    mustRegular(packageJson);
    mustRegular(path.join(contentDist, 'index.js'));
    mustRegular(path.join(contentDist, 'contracts.js'));
    const artifactSha256 = fileDigest(artifact);
    const contentLockSha256 = fileDigest(lock);
    const modules = collectModules(workerDist, 'live/render/worker.js',
        new Set(['@dreamwidth/content']));
    const contentModules = collectModules(contentDist, 'index.js',
        new Set(['css-tree', 'dompurify', 'jsdom']));
    const finalRoot = `${artifact}.runtime`;
    const tempRoot = fs.mkdtempSync(`${finalRoot}.${artifactSha256.slice(0, 12)}.` +
        `${contentLockSha256.slice(0, 12)}.tmp-`);
    let backupRoot;
    let primaryError;
    try {
        const app = path.join(tempRoot, 'app');
        fs.mkdirSync(app);
        fs.copyFileSync(lock, path.join(app, 'package-lock.json'));
        fs.copyFileSync(packageJson, path.join(app, 'package.json'));
        const npm = path.join(path.dirname(nodeExecutable), 'npm');
        const result = spawnSync(npm,
            ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
            { cwd: app, encoding: 'utf8', timeout: 120000,
                env: { ...process.env, PATH: `${path.dirname(nodeExecutable)}:${process.env.PATH}` } });
        if (result.status !== 0) fail(`production npm ci failed: ${result.stderr || result.error}`);
        removeNpmMetadata(app);
        for (const relative of modules) {
            const target = path.join(app, 'dist', relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(workerDist, relative), target);
        }
        const packageTarget = path.join(app, 'node_modules/@dreamwidth/content');
        fs.mkdirSync(packageTarget, { recursive: true });
        fs.writeFileSync(path.join(packageTarget, 'package.json'),
            JSON.stringify({ name: '@dreamwidth/content', private: true, type: 'commonjs',
                main: './dist/index.js', exports: { '.': './dist/index.js' } }) + '\n');
        for (const relative of contentModules) {
            const target = path.join(packageTarget, 'dist', relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(contentDist, relative), target);
        }
        for (const excluded of ['@playwright', 'playwright', 'playwright-core', 'typescript',
            'canvas']) {
            if (fs.existsSync(path.join(app, 'node_modules', excluded))) {
                fail(`development or native dependency installed: ${excluded}`);
            }
        }
        const typesScope = path.join(app, 'node_modules/@types');
        if (fs.existsSync(typesScope) &&
            JSON.stringify(fs.readdirSync(typesScope)) !== JSON.stringify(['trusted-types'])) {
            fail('unexpected production @types package');
        }
        // npm caches may have group write defaults; the closure is immutable
        // before hashes are recorded and the parent validates those hashes.
        const chmodTree = (dir) => {
            for (const name of fs.readdirSync(dir)) {
                const filename = path.join(dir, name);
                const stat = fs.lstatSync(filename);
                if (stat.isSymbolicLink()) fail(`symlink in closure: ${filename}`);
                if (stat.isDirectory()) {
                    chmodTree(filename);
                } else if (stat.isFile()) {
                    fs.chmodSync(filename, 0o444);
                } else {
                    fail(`non-regular closure member: ${filename}`);
                }
            }
            fs.chmodSync(dir, 0o555);
        };
        chmodTree(app);
        const files = visit(tempRoot);
        const manifest = { schema: 1, artifactSha256, contentLockSha256,
            nodeVersion, nodeExecutable, entryPath, files };
        fs.writeFileSync(path.join(tempRoot, 'manifest.json.tmp'),
            `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
        fs.renameSync(path.join(tempRoot, 'manifest.json.tmp'),
            path.join(tempRoot, 'manifest.json'));
        fs.chmodSync(tempRoot, 0o555);
        assertOwner(tempRoot);
        if (fs.existsSync(finalRoot)) {
            validatePreviousStage(finalRoot);
            backupRoot = `${finalRoot}.old-${process.pid}`;
            if (fs.existsSync(backupRoot)) fail('stale staging backup exists');
            fs.renameSync(finalRoot, backupRoot);
        }
        try { fs.renameSync(tempRoot, finalRoot); }
        catch (error) {
            if (backupRoot) fs.renameSync(backupRoot, finalRoot);
            backupRoot = undefined;
            throw error;
        }
        if (backupRoot) removeOwnedTree(backupRoot);
        console.log(JSON.stringify({ manifest: path.join(finalRoot, 'manifest.json'),
            files: files.length, workerModules: modules.length,
            contentModules: contentModules.length,
            artifactSha256, contentLockSha256 }));
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        try { removeOwnedTree(tempRoot, true); }
        catch (cleanupError) {
            if (!primaryError) throw cleanupError;
            console.error(`Private staging cleanup failed: ${String(cleanupError)}`);
        }
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3) {
            fail('usage: node tools/stage-runtime.mjs <absolute-artifact.json>');
        }
        stageRuntime(process.argv[2]);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
