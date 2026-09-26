// property-layer.ts
//
// Read a canonical native property-only compiled layer as bounded inert data.
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

import {Unsupported} from "../policy/content";

export type CustomtextProperties = Partial<Record<
    "module_customtext_show" | "module_customtext_order" | "module_customtext_section" |
    "text_module_customtext" | "text_module_customtext_url" | "text_module_customtext_content",
    string | number>>;

const types: Record<string,string> = {
    module_customtext_show:"bool", module_customtext_order:"int", module_customtext_section:"string",
    text_module_customtext:"string", text_module_customtext_url:"string", text_module_customtext_content:"string",
};
function quoted(value:string):string {
    return '"'+value.replace(/[\\$"@]/g, character=>'\\'+character).replaceAll("\n","\\n")+'"';
}

export function readPropertyLayer(source:string,id:number):CustomtextProperties {
    if (!Number.isSafeInteger(id)||id<1||Buffer.byteLength(source)>65536) throw new Unsupported();
    let position=0;
    const take=(literal:string):void=>{
        if (!source.startsWith(literal,position)) throw new Unsupported();
        position+=literal.length;
    };
    const string=():string=>{
        const start=position;
        take('"');
        let value="";
        while(position<source.length) {
            const character=source[position++]!;
            if(character==='"') {
                if(quoted(value)!==source.slice(start,position))throw new Unsupported();
                return value;
            }
            if(character==='\\') {
                const escaped=source[position++];
                if(escaped==='n')value+='\n';
                else if(escaped && '\\$"@'.includes(escaped))value+=escaped;
                else throw new Unsupported();
            } else value+=character;
        }
        throw new Unsupported();
    };
    take("#!/usr/bin/perl\n# auto-generated Perl code from input S2 code\npackage S2;\nuse strict;\n");
    take(`register_layer(${id});\n`);
    const values:CustomtextProperties=Object.create(null);
    let count=0, layerType:string|undefined;
    while(!source.startsWith("1;\n# end.\n",position)) {
        if(++count>256)throw new Unsupported();
        if(source.startsWith("set_layer_info(",position)) {
            take(`set_layer_info(${id},`);
            const key=string();take(",");const value=string();take(");\n");
            if(!["type","name","des","author","author_name","author_email"].includes(key))throw new Unsupported();
            if(key==='type')layerType=value;
        } else {
            take(`register_set(${id},`);
            const key=string();take(",");
            const type=types[key];if(!type)throw new Unsupported();
            let value:string|number;
            if(type==='string')value=string();
            else {
                const match=/^-?(?:0|[1-9][0-9]*)/.exec(source.slice(position));
                if(!match)throw new Unsupported();
                position+=match[0].length;value=Number(match[0]);
                if(!Number.isSafeInteger(value)||(type==='bool'&&value!==0&&value!==1)||
                    (type==='int'&&Math.abs(value)>10000))throw new Unsupported();
            }
            take(");\n");values[key as keyof CustomtextProperties]=value;
        }
    }
    take("1;\n# end.\n");
    if(position!==source.length||layerType!=="user")throw new Unsupported();
    return values;
}
