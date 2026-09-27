// stylesheet.ts
//
// Bound complete stock stylesheet output without entry inline-style containment.
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

import * as tree from "css-tree";
import {UnsupportedContent} from "./errors";

const pseudos=new Set(["visited","hover","active","first-child","before","last-child"]);
function safeText(value:string):void {
    if(/[<\x00-\x08\x0b\x0e-\x1f\x7f]/.test(value))throw new UnsupportedContent();
}
export function validateStockFontFamily(source:string):void {
    if(Buffer.byteLength(source)>1024)throw new UnsupportedContent();
    if(source==="")return;
    safeText(source);
    const ast=tree.parse(source,{context:"value",onParseError(){throw new UnsupportedContent();}});
    if(tree.lexer.matchProperty("font-family",ast).error)throw new UnsupportedContent();
    tree.walk(ast,node=>{
        if(!["Value","Identifier","String","Operator"].includes(node.type))throw new UnsupportedContent();
        if(node.type==="String")safeText(tree.string.decode(node.value));
        if(node.type==="Identifier")safeText(tree.ident.decode(node.name));
    });
}
export function cleanStockStylesheet(source:string):string {
    if(Buffer.byteLength(source)>65536)throw new UnsupportedContent();
    safeText(source);
    let count=0,depth=0;
    const ast=tree.parse(source,{context:"stylesheet",parseCustomProperty:true,
        onParseError(){throw new UnsupportedContent();}});
    tree.walk(ast,{enter(node:tree.CssNode) {
        if(++count>4096||++depth>16)throw new UnsupportedContent();
        if(["Raw","Url","Function"].includes(node.type))throw new UnsupportedContent();
        if(node.type==="Atrule"&&tree.ident.decode(node.name).toLowerCase()!=="media")throw new UnsupportedContent();
        if(node.type==="Declaration") {
            const property=tree.ident.decode(node.property).toLowerCase();
            if(property.startsWith("--")||["behavior","-moz-binding"].includes(property))throw new UnsupportedContent();
            if(tree.lexer.matchProperty(property,node.value).error)throw new UnsupportedContent();
        }
        if(node.type==="PseudoClassSelector"&&!pseudos.has(tree.ident.decode(node.name).toLowerCase()))throw new UnsupportedContent();
        if(node.type==="PseudoElementSelector")throw new UnsupportedContent();
        if(node.type==="String")safeText(tree.string.decode(node.value));
        if(node.type==="Identifier")safeText(tree.ident.decode(node.name));
    },leave(){depth--;}});
    const output=tree.generate(ast);
    safeText(output);
    return output;
}
