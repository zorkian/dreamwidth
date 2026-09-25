// build-stock-mechanics-page.mjs
//
// Assemble an explicitly synthetic stock-page fixture for browser harness mechanics.
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
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const [sourcePath, variant, outputPath] = process.argv.slice(2);
assert.ok(sourcePath && outputPath && ['normal-rich', 'forged-cut'].includes(variant),
    'usage: build-stock-mechanics-page.mjs <preserved-stock.html> ' +
    '<normal-rich|forged-cut> <test-only-output.html>');
const source = fs.readFileSync(sourcePath, 'utf8');
const dom = new JSDOM(source, { url: 'http://page.slice4.invalid/recent' });
const entries = dom.window.document.querySelectorAll('div.entry-content');
assert.ok(entries.length >= 2, 'preserved stock page must contain two entries');
assert.ok(dom.window.document.querySelector('script[src]'),
    'preserved stock page must have its script context');
const cut = '<span class="cut-wrapper"><span style="display: none;" ' +
    'id="span-cuttag_s2js_slice3_123_1" class="cuttag"></span>' +
    '<b class="cut-open">(&nbsp;</b><b class="cut-text"><a ' +
    'href="http://localhost:8080/~s2js_slice3/123.html#cutid1">Real cut</a></b>' +
    '<b class="cut-close">&nbsp;)</b></span><div style="display: none;" ' +
    'id="div-cuttag_s2js_slice3_123_1" aria-live="assertive"></div>';
const rich = '<p>After cut visible</p>' +
    '<img src="https://asset.slice4.invalid/pixel.png" alt="Pixel">' +
    '<map name="fixturemap"><area shape="rect" coords="0,0,1,1" href="#fixture"></map>' +
    '<img src="https://asset.slice4.invalid/map.png" usemap="#fixturemap" alt="Mapped">' +
    '<span style="background-image:url(https://asset.slice4.invalid/bg.png)">' +
    'background</span>' + cut;
const forged = '<span class="cuttag">Forged cut control</span>' + cut +
    '<p>Visible after cut</p>';
entries[0].innerHTML = variant === 'normal-rich' ? rich : forged;
assert.ok(!dom.serialize().includes('HIDDEN-'), 'synthetic fixture must omit hidden body');
fs.writeFileSync(outputPath, dom.serialize());
process.stdout.write(JSON.stringify({variant, bytes: fs.statSync(outputPath).size,
    source: 'test-only-stock-mechanics-assembly'}) + '\n');
