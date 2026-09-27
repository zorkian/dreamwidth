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
// CSS parsers repair EOF and discard comments. Prove each original scalar is
// token-closed before stock concatenates it with other independently proved
// pieces. The maintained tokenizer alone decides string/escape boundaries.
function proveScalarPiece(source:string):void {
    const tokens:{type:number;start:number;end:number}[]=[];
    tree.tokenize(source,(type,start,end)=>{
        if([tree.tokenTypes.Comment,tree.tokenTypes.BadString,tree.tokenTypes.BadUrl].includes(type))throw new UnsupportedContent();
        tokens.push({type,start,end});
    });
    let index=0;
    // A stock delimiter must be a separate token. Unterminated strings and
    // trailing escapes instead consume it or change their original token span.
    tree.tokenize(source+";",(type,start,end)=>{
        if(start>=source.length)return;
        const original=tokens[index++];
        if(!original||type!==original.type||start!==original.start||end!==original.end)throw new UnsupportedContent();
    });
    if(index!==tokens.length)throw new UnsupportedContent();
}

export function validateStockFontFamily(source:string):void {
    if(Buffer.byteLength(source)>1024)throw new UnsupportedContent();
    if(source==="")return;
    safeText(source);
    proveScalarPiece(source);
    const ast=tree.parse(source,{context:"value",onParseError(){throw new UnsupportedContent();}});
    if(tree.lexer.matchProperty("font-family",ast).error)throw new UnsupportedContent();
    tree.walk(ast,node=>{
        if(!["Value","Identifier","String","Operator"].includes(node.type))throw new UnsupportedContent();
        if(node.type==="String")safeText(tree.string.decode(node.value));
        if(node.type==="Identifier")safeText(tree.ident.decode(node.name));
    });
}

// Prove one original emitted size+unit value, never a declaration fragment.
// The maintained grammar decides accepted numbers/units; no normalization.
export function validateStockFontSize(source:string):void {
    if(Buffer.byteLength(source)>1024||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source))throw new UnsupportedContent();
    safeText(source);
    proveScalarPiece(source);
    const ast=tree.parse(source,{context:"value",onParseError(){throw new UnsupportedContent();}});
    if(tree.lexer.matchProperty("font-size",ast).error)throw new UnsupportedContent();
    tree.walk(ast,node=>{
        if(!["Value","Identifier","Dimension","Percentage","Number"].includes(node.type))throw new UnsupportedContent();
        if(node.type==="Identifier")safeText(tree.ident.decode(node.name));
    });
}

// Only the qualified EasyRead+Aqua stock generator has this native-invalid
// output. Browser CSSOM discards these complete declarations/rule. Account for
// every error/Raw by maintained source locations before omitting anything.
export interface StockFontExpectation {pageFont:string;entryColor:string}
function omitEasyReadInvalid(source:string,expectation?:StockFontExpectation):string {
    let family:string|undefined,size:string|undefined;
    if(expectation) {
        if(expectation.entryColor!=="color: #cdc1ac")throw new UnsupportedContent();
        const font=tree.parse(expectation.pageFont,{context:"declarationList",positions:true,
            onParseError(){throw new UnsupportedContent();}});
        tree.walk(font,node=>{
            if(node.type!=="Declaration")return;
            if(node.value.type!=="Value"||!node.loc)throw new UnsupportedContent();
            const value=expectation.pageFont.slice(node.loc.start.offset+node.property.length+2,node.loc.end.offset);
            if(node.property==="font-family"&&family===undefined){validateStockFontFamily(value);family=value;}
            else if(node.property==="font-size"&&size===undefined){validateStockFontSize(value);size=value;}
            else throw new UnsupportedContent();
        });
        if(expectation.pageFont!==(family===undefined?"":`font-family: ${family}; `)+
            (size===undefined?"":`font-size: ${size};`))throw new UnsupportedContent();
    }
    const errors:{offset:number;message:string}[]=[];
    const ast=tree.parse(source,{context:"stylesheet",positions:true,
        onParseError(error){errors.push({offset:error.offset,message:error.message});}});
    const ranges:{start:number;end:number}[]=[];
    const fontOffsets:number[]=[];
    const fonts=new Set<string>();
    let separators=0,colors=0,firstRules=0,emptyFonts=0,count=0,depth=0;
    const span=(node:tree.CssNode):{start:number;end:number}=>{
        if(!node.loc)throw new UnsupportedContent();
        return {start:node.loc.start.offset,end:node.loc.end.offset};
    };
    tree.walk(ast,{enter(this:tree.WalkContext,node:tree.CssNode) {
        if(++count>4096||++depth>16)throw new UnsupportedContent();
        const selector=this.rule?tree.generate(this.rule.prelude):"";
        if(node.type==="Raw") {
            const location=span(node);
            if(this.declaration?.property==="font-family"&&
                ["#primary,#secondary,#tertiary,#footer","body"].includes(selector)&&
                !fonts.has(selector)) {
                const declaration=span(this.declaration);
                if(source.slice(declaration.start,location.start)!==(expectation&&family===undefined&&size===undefined?"font-family: \n    ":"font-family: "))throw new UnsupportedContent();
                if(expectation) {
                    const neither=family===undefined&&size===undefined;
                    const expected=family!==undefined?`font-family: ${family}`:
                        size!==undefined?`font-size: ${size}`:expectation.entryColor;
                    if(source.slice(declaration.start,declaration.end)!=="font-family: "+(neither?"\n    ":"")+expected||neither&&selector==="body")throw new UnsupportedContent();
                    const prefix=family!==undefined?"font-family":size!==undefined?"font-size":"color";
                    fontOffsets.push(location.start+prefix.length);
                    const tail=family!==undefined?(size===undefined?"; ":`; font-size: ${size};`):";";
                    if(!source.slice(declaration.end).startsWith(tail))throw new UnsupportedContent();
                    if(neither&&source.slice(declaration.start,declaration.end)!==
                        "font-family: \n    "+expectation.entryColor)throw new UnsupportedContent();
                } else {
                    if(!node.value.startsWith("font-family: "))throw new UnsupportedContent();
                    validateStockFontFamily(node.value.slice("font-family: ".length));
                    if(!source.slice(location.end).startsWith("; font-size: 1em;"))throw new UnsupportedContent();
                    fontOffsets.push(location.start+"font-family".length);
                }
                if(source[declaration.end]!==";")throw new UnsupportedContent();
                fonts.add(selector);ranges.push({...declaration,end:declaration.end+1});
            } else if(!this.declaration&&selector==="body"&&node.value===";") {
                const preceding=expectation?.pageFont??"font-family: unused; font-size: 1em;";
                if(expectation&&preceding===""||!source.slice(0,location.start).endsWith(
                    expectation?preceding:"font-size: 1em;"))throw new UnsupportedContent();
                separators++;ranges.push(location);
            } else throw new UnsupportedContent();
        }
        if(expectation&&family===undefined&&size===undefined&&node.type==="Declaration"&&node.property==="font-family"&&
            node.value.type==="Value"&&node.value.children.isEmpty) {
            const location=span(node);
            if(selector!=="body"||source.slice(location.start,location.end)!=="font-family: "||source[location.end]!==";")throw new UnsupportedContent();
            emptyFonts++;ranges.push({...location,end:location.end+1});
        }
        if(node.type==="Declaration"&&node.property==="color"&&node.value.type==="Value"&&node.value.children.isEmpty) {
            if(selector!==".ContextualPopup a:hover")throw new UnsupportedContent();
            colors++;const location=span(node);
            if(source[location.end]!==";")throw new UnsupportedContent();
            ranges.push({...location,end:location.end+1});
        }
        if(node.type==="Rule"&&tree.generate(node.prelude)===".entry .metadata-label:first") {
            if(node.block.children.size!==1||tree.generate(node.block)!=="{text-transform:uppercase}")throw new UnsupportedContent();
            firstRules++;ranges.push(span(node));
        }
    },leave(){depth--;}});
    const neither=expectation!==undefined&&family===undefined&&size===undefined;
    if(fonts.size!==(neither?1:2)||emptyFonts!==(neither?1:0)||separators!==(neither?0:1)||colors!==1||firstRules!==1||errors.length!==(neither?1:2)||
        errors.some(error=>error.message!=="Unexpected input"||!fontOffsets.includes(error.offset))||
        new Set(errors.map(error=>error.offset)).size!==(neither?1:2))throw new UnsupportedContent();
    let result=source;
    for(const range of ranges.sort((a,b)=>b.start-a.start))result=result.slice(0,range.start)+result.slice(range.end);
    return result;
}

export function cleanStockStylesheet(source:string, policy?:"easyread-aqua",expectation?:StockFontExpectation):string {
    if(Buffer.byteLength(source)>65536)throw new UnsupportedContent();
    safeText(source);
    // The qualified retained ProxyCSSLinks callback scans raw strings/comments,
    // not CSS nodes. It is an identity only without this literal byte trigger.
    if(/\burl\(/i.test(source))throw new UnsupportedContent();
    if(expectation&&policy!=="easyread-aqua")throw new UnsupportedContent();
    if(policy==="easyread-aqua")source=omitEasyReadInvalid(source,expectation);
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
        if(node.type==="PseudoClassSelector"&&!pseudos.has(tree.ident.decode(node.name).toLowerCase())&&
            !(policy==="easyread-aqua"&&["after","focus"].includes(tree.ident.decode(node.name).toLowerCase())))throw new UnsupportedContent();
        if(node.type==="PseudoElementSelector")throw new UnsupportedContent();
        if(node.type==="String")safeText(tree.string.decode(node.value));
        if(node.type==="Identifier")safeText(tree.ident.decode(node.name));
    },leave(){depth--;}});
    const output=tree.generate(ast);
    safeText(output);
    if(/\burl\(/i.test(output))throw new UnsupportedContent();
    return output;
}
