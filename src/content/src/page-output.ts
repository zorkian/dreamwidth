// page-output.ts
//
// Page-local native HTMLCleaner and nested CSS output channels.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Semantic ports: cgi-bin/HTMLCleaner.pm and cgi-bin/LJ/S2.pm.
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//

import {Tokenizer, type TokenizerCallbacks} from "htmlparser2";
import type {PageChunk,PageOutput,PageOutputOptions} from "./page-output-types";
import {concatenate,copyChunk,encodedEntityView,parserView,scalarView,viewChunk} from "./page-chunks";
import {decodeNativeEntities} from "./native-entities";
import {cleanPageCss,stylesheetDestination} from "./page-css";

const eat=new Set(["script","object","iframe","applet","embed","param"]);
const literal=new Set(["script","style","xmp","textarea","title","plaintext"]);
const linkRelations=new Set("icon shortcut alternate next prev index made start search top help up author edituri file-list previous home contents bookmark chapter section subsection appendix glossary copyright child".split(" "));
const white=/[\x09-\x0d\x20]/g;
const angles=(s: string)=>s.replaceAll("<","&lt;").replaceAll(">","&gt;");
const escape=(s: string)=>s.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("'","&#39;").replaceAll("<","&lt;").replaceAll(">","&gt;");
function decodeAttr(value: string): string {
    // HTML::Parser utf8_mode preserves a valid byte string; its attribute
    // decoder upgrades the whole Latin1 scalar when those octets are invalid.
    try {new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(value,c=>c.charCodeAt(0)));}
    catch {value=encodedEntityView(value);}
    return value.replace(/&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9_]*);?/g,token=>{
        const decoded=decodeNativeEntities(token);
        return decoded===token ? token : encodedEntityView(decoded);
    });
}

export function createPageOutput(options: PageOutputOptions): PageOutput {
    for(const limit of Object.values(options.limits))if(!Number.isSafeInteger(limit)||limit<1)throw new Error("Invalid page output limits");
    const deadline=Date.now()+options.limits.timeoutMs;
    let inputBytes=0,outputBytes=0,finished=false,needFlush=false,cssDepth=0,printCount=0;
    let css: PageChunk[]=[];
    const check=()=>{if(finished)throw new Error("Page output already finished");if(Date.now()>deadline)throw new Error("Page output deadline");};
    const emit=(chunk: PageChunk)=>{
        check();const copy=copyChunk(chunk);outputBytes+=copy.bytes.length;
        if(outputBytes>options.limits.maxOutputBytes)throw new Error("Page output bound");options.output(copy);
    };
    const cleanerEmit=(value: string)=>{
        let chunk=viewChunk(value);
        if(/lj-embed/i.test(value))chunk=copyChunk(options.expandEmbed(chunk));
        emit(chunk);
    };
    let parserBytes=0,titleFallback=false;
    let markupStart=0,markedSection=false;
    let source="",pendingText="",tagName="",attrName="",attrValue="",tagStart=0;
    let seq: string[]=[],attrs=new Map<string,string>();
    const eating: string[]=[];
    let style: string|null=null;
    let literalTag: string|null=null,literalBuffer="",literalPrevious="",literalCandidateStart=-1;
    const text=(value: string)=>{
        if(eating.length)return;
        if(style!==null){style+=value;return;}
        if(value!=="<!-- -->")cleanerEmit(angles(value));
    };
    const flushText=()=>{if(pendingText){text(pendingText);pendingText="";}};
    const endTag=(name: string)=>{
        flushText();if(eating.length){if(eating.at(-1)===name)eating.pop();return;}
        if(style!==null){cleanerEmit(cleanPageCss(style,false));style=null;}
        cleanerEmit("</"+name+">");
    };
    const closeFallbackTitle=()=>{if(titleFallback){titleFallback=false;endTag("title");}};
    const commitAttribute=()=>{seq.push(attrName);if(!attrs.has(attrName))attrs.set(attrName,decodeAttr(attrValue));attrValue="";};
    const startTag=(end: number,slash=false)=>{
        flushText();closeFallbackTitle();let name=tagName.toLowerCase().replace("<","");
        // HTML::Parser includes a nonclosing slash suffix in its tagname.
        // The maintained tokenizer provides the exact name end/raw tag span.
        const raw=source.slice(tagStart,end+1);
        const suffix=/^[^\s>]+/.exec(raw.slice(1))?.[0] ?? name;
        if(suffix.includes("/")&&!suffix.endsWith("/"))name=suffix.toLowerCase();
        const split=name.indexOf("/");
        if(split>=0){const rest=name.slice(split+1);name=name.slice(0,split);if(rest)eating.push(name+"/"+rest);else slash=true;}
        if(eat.has(name)||/^(g|fb):/.test(name))eating.push(name);
        if(!eating.length){
            let keep=true;
            const cleanName=name.replace(/^.*:/s,'').replace(/[^a-zA-Z0-9_]/g,'');
            if(cleanName==='meta'){
                const equiv=(attrs.get('http-equiv')??'').toLowerCase().replace(/[\s\x0b]/,'');
                keep=!/refresh|content-type|link|set-cookie/.test(equiv);
            }
            if(cleanName==='link'){
                const rel=attrs.get('rel')??'',href=attrs.get('href')??'';
                if(/\bstylesheet\b/i.test(rel)){
                    const destination=stylesheetDestination(href,options.stylesheet);
                    keep=destination!==false;if(keep)attrs.set('href',destination as string);
                } else keep=attrs.size===0 || /^(service|openid)\.\w+$/.test(rel) || linkRelations.has(rel.toLowerCase()) ||
                    (attrs.has('href')&&attrs.size===1) || rel.split(/\s+/).every(part=>linkRelations.has(part));
            }
            if(keep){
                let out='<'+name;
                for(const key of seq){
                    if(key==='/'){slash=true;continue;}
                    if(key==='datasrc'||key==='datafld'||/^on/i.test(key)||/(^=)|[\x0b\x0d]/.test(key))continue;
                    let value=attrs.get(key)??'';
                    if(key==='style'){value=cleanPageCss(value,false);attrs.set(key,value);}
                    if(name==='input'&&key==='type'&&/^password$/i.test(value)){value='';attrs.delete(key);}
                    const compact=value.replace(white,'').replaceAll('\0','');
                    if(/(vbscript|javascript|about):/i.test(compact)){value='';attrs.delete(key);}
                    out+=' '+key+'="'+escape(value)+'"';
                }
                cleanerEmit(out+(slash?' />':'>'));
                if(name==='style')style='';
            }
        }
        if(literal.has(name))literalTag=name;
        seq=[];attrs=new Map();attrName='';attrValue='';
    };
    const callbacks: TokenizerCallbacks={
        onopentagname:(start,end)=>{tagName=source.slice(start,end);tagStart=start-1;seq=[];attrs=new Map();},
        onattribname:(start,end)=>{attrName=source.slice(start,end).toLowerCase();attrValue='';},
        onattribdata:(start,end)=>{attrValue+=source.slice(start,end);},
        onattribentity:()=>{throw new Error("Unexpected tokenizer entity decode");},
        onattribend:quote=>{if(quote===0)attrValue=attrName;commitAttribute();},
        onopentagend:end=>{startTag(end);markupStart=source.length;},onselfclosingtag:end=>{startTag(end,true);markupStart=source.length;},
        onclosetag:(start,end)=>{closeFallbackTitle();endTag(source.slice(start,end).toLowerCase());markupStart=source.length;},
        ontext:(start,end)=>{pendingText+=source.slice(start,end);markupStart=end;},
        ontextentity:()=>{throw new Error("Unexpected tokenizer text decode");},
        oncomment:()=>{flushText();markupStart=source.length;},onprocessinginstruction:()=>{flushText();markupStart=source.length;},
        ondeclaration:(start,end)=>{flushText();closeFallbackTitle();markupStart=source.length;if(source[start]==='[')return;cleanerEmit('<!'+(source.slice(start,end).match(/"[^"]*"|'[^']*'|[^\s]+/g)??[]).map(angles).join(' ')+'>');},
        oncdata:(start,end)=>{
            flushText();closeFallbackTitle();
            // With marked_sections disabled native treats the opener through
            // its first > as a discarded declaration, then parses the remainder.
            const body=source.slice(start,end),cut=body.indexOf(">");
            if(cut>=0)replay(body.slice(cut+1)+">");
        },
        onend:()=>flushText(),
    };
    // XML lexical mode avoids HTML5 implied element handling and its hardcoded
    // literal set. Native literal spans are handled separately below.
    let tokenizer=new Tokenizer({xmlMode:true,decodeEntities:false},callbacks);
    const replay=(value: string)=>{
        const savedSource=source,savedTokenizer=tokenizer,savedMarkupStart=markupStart;
        source="";markupStart=0;tokenizer=new Tokenizer({xmlMode:true,decodeEntities:false},callbacks);
        feed(value,false);tokenizer.end();
        source=savedSource;tokenizer=savedTokenizer;markupStart=savedMarkupStart;
    };
    const feed=(value: string,charge=true)=>{
        // Feed one input unit until a completed native literal start switches
        // modes; token boundaries always come from the maintained tokenizer.
        if(charge)parserBytes+=value.length;
        if(parserBytes>options.limits.maxInputBytes)throw new Error("Page parser input bound");
        for(let i=0;i<value.length;i++){
            if((i&1023)===0)check();
            const char=value[i]!;
            if(markedSection){
                // Native marked_sections is off: the declaration is discarded
                // through its first >, including a CDATA opener. The tracked
                // public-token boundary prevents matches in attributes/comments.
                if(char==='>'){markedSection=false;source='';markupStart=0;
                    tokenizer=new Tokenizer({xmlMode:true,decodeEntities:false},callbacks);}
                continue;
            }
            if(literalTag!==null){
                literalBuffer+=char;
                if(literalPrevious==='<' && char==='/')literalCandidateStart=literalBuffer.length-2;
                literalPrevious=char;
                if(literalTag==='plaintext')continue;
                const candidateStart=char==='>' ? literalCandidateStart : -1;
                const candidate=candidateStart>=0 ? literalBuffer.slice(candidateStart) : '';
                const match=new RegExp('^</'+literalTag+'[\\x09-\\x0d ]*>$','i').test(candidate);
                let closed=false;
                if(match){
                    const validator=new Tokenizer({xmlMode:true,decodeEntities:false},{...callbacks,
                        onclosetag:(start,end)=>{closed=candidate.slice(start,end).toLowerCase()===literalTag;},
                        ontext:()=>{},onopentagname:()=>{},onopentagend:()=>{},onattribname:()=>{},
                        onattribdata:()=>{},onattribend:()=>{},oncomment:()=>{},onend:()=>{},
                    });
                    validator.write(candidate);validator.end();
                }
                if(closed){
                    text(literalBuffer.slice(0,candidateStart));endTag(literalTag);
                    literalTag=null;literalBuffer='';literalPrevious='';literalCandidateStart=-1;
                    // A fresh lexical stream after a native literal close.
                    source='';tokenizer=new Tokenizer({xmlMode:true,decodeEntities:false},callbacks);
                }
                continue;
            }
            source+=char;tokenizer.write(char);
            if(source.endsWith('<![CDATA[')&&source.length-9===markupStart){
                flushText();closeFallbackTitle();markedSection=true;
            }
        }
    };
    const html=/^text\/html/.test(options.contentType);
    const raw=(chunk: PageChunk)=>{
        if(html&&needFlush){feed('<!-- -->');needFlush=false;}emit(chunk);
        if(++printCount%8===0)options.checkDepth();
    };
    const safe=(chunk: PageChunk)=>{
        if(!html){raw(chunk);return;}feed(parserView(chunk));needFlush=true;
        if(++printCount%8===0)options.checkDepth();
    };
    const write=(chunk: PageChunk,safeChannel: boolean)=>{
        check();const copy=copyChunk(chunk);inputBytes+=copy.bytes.length;
        if(inputBytes>options.limits.maxInputBytes)throw new Error("Page input bound");
        if(cssDepth)css.push(copy);else (safeChannel?safe:raw)(copy);
    };
    const output: PageOutput={
        printRaw:chunk=>write(chunk,false),printSafe:chunk=>write(chunk,true),
        startCss(){check();if(cssDepth++===0)css=[];},
        endCss(){check();if(!cssDepth||--cssDepth!==0)return;
            const buffer=concatenate(css);css=[];
            const cleaned=cleanPageCss(scalarView(buffer),true);
            const chunk=viewChunk(cleaned,cleaned===scalarView(buffer)&&buffer.utf8);
            const transformed=copyChunk(options.transformCss(chunk));
            raw(concatenate([viewChunk('/* Cleaned CSS: */\n'),transformed,viewChunk('\n')]));
        },
        finish(){check();if(options.contentType==='text/css')output.endCss();
            if(html){if(literalTag!==null){
                const name=literalTag,buffer=literalBuffer;
                literalTag=null;literalBuffer='';
                if(name==='style'||name==='script'){endTag(name);replay(buffer);}
                else if(name==='title'){titleFallback=true;replay(buffer);flushText();closeFallbackTitle();}
                else text(buffer);
            }else tokenizer.end();}
            finished=true;
        },
    };
    if(options.contentType==='text/css')output.startCss();
    return output;
}
