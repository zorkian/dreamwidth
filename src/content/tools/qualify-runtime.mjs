// qualify-runtime.mjs
//
// Check the locked cleaner libraries under the existing bounded child controls.
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
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = '/opt/dw-node24/bin/node';
const nodeDigest = '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c';
const [sandbox, originalProbe] = process.argv.slice(2);
assert.equal(process.execPath, node);
assert.equal(process.version, 'v24.21.0');
assert.equal(createHash('sha256').update(fs.readFileSync(node)).digest('hex'), nodeDigest);
assert.ok(path.isAbsolute(sandbox) && path.isAbsolute(originalProbe),
    'usage: node tools/qualify-runtime.mjs <existing-sandbox> <original-sandbox-probe.js>');
for (const filename of [sandbox, originalProbe]) {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-content-qualification-'));
try {
    fs.copyFileSync(path.join(root, 'package.json'), path.join(temp, 'package.json'));
    fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(temp, 'package-lock.json'));
    const npm = path.join(path.dirname(node), 'npm');
    const install = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: temp, encoding: 'utf8', timeout: 120000,
            env: { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH}` } });
    assert.equal(install.status, 0, install.stderr || String(install.error));
    fs.rmSync(path.join(temp, 'node_modules/.bin'), { recursive: true, force: true });
    fs.rmSync(path.join(temp, 'node_modules/.package-lock.json'), { force: true });
    for (const scope of ['@types', '@playwright']) {
        const directory = path.join(temp, 'node_modules', scope);
        if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
            fs.rmdirSync(directory);
        }
    }
    for (const name of ['@playwright', 'playwright', 'playwright-core', 'typescript', 'canvas']) {
        assert.equal(fs.existsSync(path.join(temp, 'node_modules', name)), false,
            `development or native package installed: ${name}`);
    }
    const typesScope = path.join(temp, 'node_modules/@types');
    assert.deepEqual(fs.existsSync(typesScope) ? fs.readdirSync(typesScope) : [],
        ['trusted-types'], 'only DOMPurify production trusted-types declarations may be present');
    const inspect = (directory) => {
        for (const name of fs.readdirSync(directory)) {
            const filename = path.join(directory, name);
            const stat = fs.lstatSync(filename);
            assert.equal(stat.isSymbolicLink(), false, `symlink: ${filename}`);
            if (stat.isDirectory()) inspect(filename);
            else {
                assert.ok(stat.isFile() && !name.endsWith('.node'), `nonregular/native: ${filename}`);
            }
        }
    };
    inspect(path.join(temp, 'node_modules'));

    fs.writeFileSync(path.join(temp, 'probe.cjs'), `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const cssTree = require('css-tree');
const dom = new JSDOM('<!doctype html><body></body>',
    { url: 'https://synthetic.invalid/page', runScripts: 'outside-only' });
const clean = createDOMPurify(dom.window).sanitize('<p class="ok">rich <b>body</b></p><script>bad()</script>');
assert.equal(clean, '<p class="ok">rich <b>body</b></p>');
const ast = cssTree.parse('color:red;--x:var(--y);background:url(https://synthetic.invalid/x)',
    { context: 'declarationList' });
assert.equal(cssTree.generate(ast).includes('url('), true);
assert.throws(() => fs.readFileSync('/workspaces/dreamwidth/etc/config-local.pl'),
    error => error.code === 'ERR_ACCESS_DENIED');
assert.throws(() => fs.writeFileSync('/tmp/dw-content-worker-must-not-write', 'x'),
    error => error.code === 'ERR_ACCESS_DENIED');
dom.window.close();
console.log('locked DOMPurify/jsdom/CSS Tree load and credential/write denial PASS');
`);
    const minimalEnv = { LANG: 'C.UTF-8', TZ: 'UTC' };
    const original = spawnSync(sandbox, [node, '--permission', '--no-addons',
        '--disable-proto=throw', '--max-old-space-size=128',
        `--allow-fs-read=${originalProbe}`, originalProbe],
        { env: minimalEnv, cwd: temp, encoding: 'utf8', timeout: 10000 });
    assert.equal(original.status, 0, original.stderr || String(original.error));
    assert.match(original.stdout, /credential\/file\/child\/worker\/TCP\/Unix\/listen\/UDP denied/);
    const libraries = spawnSync(sandbox, [node, '--permission', '--no-addons',
        '--disable-proto=throw', '--max-old-space-size=128',
        `--allow-fs-read=${temp}`, path.join(temp, 'probe.cjs')],
        { env: minimalEnv, cwd: temp, encoding: 'utf8', timeout: 10000 });
    assert.equal(libraries.status, 0, libraries.stderr || String(libraries.error));
    assert.match(libraries.stdout, /locked DOMPurify\/jsdom\/CSS Tree load/);
    console.log(JSON.stringify({ node: process.version, originalDenials: original.stdout.trim(),
        libraryLoad: libraries.stdout.trim(), productionPackageCount:
            fs.readdirSync(path.join(temp, 'node_modules')).length }));
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
