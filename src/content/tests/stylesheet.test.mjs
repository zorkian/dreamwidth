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
import {cleanStockStylesheet,validateStockFontFamily} from '../dist/index.js';
test('stock selector/media grammar survives; active/resource/style-end syntax refuses',()=>{
 assert.equal(cleanStockStylesheet('@media screen and (min-width: 40em) { #primary > .inner:first-child { position: absolute; color: #123456; } }'), '@media screen and (min-width:40em){#primary>.inner:first-child{position:absolute;color:#123456}}');
 for(const css of ['p{background:url(https://bad.invalid)}','@import "bad.css";','p{behavior:x}','p{color:expression(x)}','p{--x:red}','p{color:red}</style>','p{content:"\\3c /style"}','@font-face{font-family:x}','p{b\\65 havior:x}','p{color:rgb(0,0,0)}','p{font-family:"url(foo)"}','/* URL(foo) */p{color:red}'])assert.throws(()=>cleanStockStylesheet(css),css);
 validateStockFontFamily('"Open Sans", Georgia, serif');
});
