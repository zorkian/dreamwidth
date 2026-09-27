// stylesheet.test.mjs
//
// Complete stock stylesheet syntax and resource isolation.
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanStockStylesheet,validateStockFontFamily,validateStockFontSize} from '../dist/index.js';
test('stock selector/media grammar survives; active/resource/style-end syntax refuses',()=>{
 assert.equal(cleanStockStylesheet('@media screen and (min-width: 40em) { #primary > .inner:first-child { position: absolute; color: #123456; } }'), '@media screen and (min-width:40em){#primary>.inner:first-child{position:absolute;color:#123456}}');
 for(const css of ['p{background:url(https://bad.invalid)}','@import "bad.css";','p{behavior:x}','p{color:expression(x)}','p{--x:red}','p{color:red}</style>','p{content:"\\3c /style"}','@font-face{font-family:x}','p{b\\65 havior:x}','p{color:rgb(0,0,0)}','p{font-family:"url(foo)"}','/* URL(foo) */p{color:red}'])assert.throws(()=>cleanStockStylesheet(css),css);
 assert.throws(()=>cleanStockStylesheet('p:focus{color:red}'));
 assert.throws(()=>cleanStockStylesheet('p:after{content:"x"}'));
 assert.throws(()=>cleanStockStylesheet('p:focus{color:red}','easyread-aqua'));
 validateStockFontFamily('"Open Sans", Georgia, serif');
});

test('font size proof is one maintained CSS value and preserves caller bytes',()=>{
 for(const value of ['1.25em','120%','16px','0','medium'])assert.equal(validateStockFontSize(value),undefined);
 for(const value of ['', ' ', '1px;color:red', '1px}', 'calc(1px + 2px)', 'url(x)', 'var(--size)', '1px!important', '</style>', '\uD800'])assert.throws(()=>validateStockFontSize(value),value);
});

test('original font pieces are token closed before stock concatenation',()=>{
 for(const value of ['Georgia /*','Georgia /**/', '"x', '"x\\"', 'Georgia\\'])assert.throws(()=>validateStockFontFamily(value),value);
 for(const value of ['0/*em','1em/**/','1em\\'])assert.throws(()=>validateStockFontSize(value),value);
 for(const value of ['Georgia','"Open Sans", serif','"comment /* inside closed string"','G\\65 orgia'])validateStockFontFamily(value);
 validateStockFontSize('1em');
});
