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
    string | number>> & Partial<Record<"color_page_background" | "font_base" | "module_tags_show" | "module_tags_order" |
    "module_userprofile_show" | "module_userprofile_order" | "module_userprofile_section" |
    "module_links_show" | "module_links_order" | "module_links_section" |
    "module_pagesummary_show" | "module_pagesummary_order" | "module_pagesummary_section" |
    "module_calendar_show" | "module_calendar_order" | "module_calendar_section" |
    "module_tags_section", string | number>> & Partial<Record<
    "font_fallback" | "font_base_size" | "font_base_units" |
    "font_module_heading" | "font_module_heading_size" | "font_module_heading_units" |
    "font_module_text" | "font_module_text_size" | "font_module_text_units" |
    "font_journal_title" | "font_journal_title_size" | "font_journal_title_units" |
    "font_journal_subtitle" | "font_journal_subtitle_size" | "font_journal_subtitle_units" |
    "font_entry_title" | "font_entry_title_size" | "font_entry_title_units" |
    "font_comment_title" | "font_comment_title_size" | "font_comment_title_units", string>>;

const types: Record<string,string> = {
    font_fallback:"string", font_base_size:"string", font_base_units:"string",
    font_module_heading:"string", font_module_heading_size:"string", font_module_heading_units:"string",
    font_module_text:"string", font_module_text_size:"string", font_module_text_units:"string",
    font_journal_title:"string", font_journal_title_size:"string", font_journal_title_units:"string",
    font_journal_subtitle:"string", font_journal_subtitle_size:"string", font_journal_subtitle_units:"string",
    font_entry_title:"string", font_entry_title_size:"string", font_entry_title_units:"string",
    font_comment_title:"string", font_comment_title_size:"string", font_comment_title_units:"string",

    module_userprofile_show:"bool", module_userprofile_order:"int", module_userprofile_section:"string",
    module_links_show:"bool", module_links_order:"int", module_links_section:"string",
    module_pagesummary_show:"bool", module_pagesummary_order:"int", module_pagesummary_section:"string",
    module_calendar_show:"bool", module_calendar_order:"int", module_calendar_section:"string",
    module_tags_section:"string",
    color_page_background:"Color", font_base:"string", module_tags_show:"bool", module_tags_order:"int",
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
            if(type==='Color') {
                take('S2::Builtin::LJ::Color__Color('); value=string(); take(')');
                if(!/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})?$/.test(value))throw new Unsupported();
            } else if(type==='string')value=string();
            else {
                const match=/^-?(?:0|[1-9][0-9]*)/.exec(source.slice(position));
                if(!match)throw new Unsupported();
                position+=match[0].length;value=Number(match[0]);
                if(!Number.isSafeInteger(value)||(type==='bool'&&value!==0&&value!==1)||
                    (type==='int'&&Math.abs(value)>10000))throw new Unsupported();
            }
            take(");\n");(values as Record<string,string|number>)[key]=value;
        }
    }
    take("1;\n# end.\n");
    if(position!==source.length||layerType!=="user")throw new Unsupported();
    return values;
}
