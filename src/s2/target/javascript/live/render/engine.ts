// engine.ts
//
// Run unchanged stock layer initialization and printing from admitted live data.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/S2.pm s2_context/escape_all_props and journal footer insertion.
//
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
//
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//


import { Context, cleanTrustedSafeChunk } from "../../runtime/s2runtime";
import { instantiate, StockLayer } from "./artifact";
import { callbacks } from "./builtins";
import { prepare } from "./prepare";
import { head, hostData } from "./host";
import type { Artifact, RenderContentPreparation, RenderInput } from "./types";

function escapeProperties(ctx: Context, layers: StockLayer[], content:RenderContentPreparation): void {
    function escape(value: unknown, mode: string): unknown {
        if (Array.isArray(value)) return value.map(item => escape(item, mode));
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escape(v, mode)]));
        }
        if (typeof value !== "string") return value;
        // Stock non-plain HTML/CSS properties are empty. Refuse any expansion
        // of that domain rather than silently substitute a different cleaner.
        if (mode === "html" && content.customtext) return content.customtext(value);
        if (mode !== "plain" && value) throw new Error("Unsupported stock property cleaner");
        return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br />");
    }
    for (const layer of layers) for (const [name, metadata] of layer.metadata) {
        const key = name.startsWith("_") ? name : "_" + name;
        if (ctx.prop[key]) ctx.prop[key] = escape(ctx.prop[key], metadata.attributes.string_mode || "plain");
    }
}

export function renderStock(artifact: Artifact, input: RenderInput, maxBytes: number,
    content: RenderContentPreparation): string {
    const finalized=new Set<string>();
    const cleaned=new Set<string>();
    const originalContent=content;
    content={...originalContent,...(originalContent.customtext?{customtext(source:string) {
        const value=originalContent.customtext!(source);cleaned.add(value);return value;
    }}:{})};
    const layers = instantiate(artifact);
    if(input.journal.customtextProperties) {
        const data=new StockLayer();
        for(const [name,value] of Object.entries(input.journal.customtextProperties)) {
            const metadata=layers.map(layer=>layer.metadata.get('_'+name)).find(Boolean);
            if(!metadata||typeof value!==(metadata.type==='string'?'string':'number'))throw new Error('Invalid property type');
            data.setProperty('_'+name,value);
        }
        layers.push(data);
    }
    let printing = false;
    let html = "";
    let bytes = 0;
    // Helpers close over objects populated only after source init completes.
    const page: Record<string, any> = {};
    const host: Record<string, any> = {};
    const c = input.config;
    const expansion=input.page.kind==='entry'&&input.journal.comments?.expandAllowed&&input.journal.comments.collapsed?
        (()=>{
            const current=input.journal.comments!.page;
            const suffix=`?expand_all=1${current>1?'&page='+current:''}#comments`;
            return {original:`onClick="Expander.make(this,'${input.journal.baseUrl}/${input.page.kind==='entry'?input.page.ditemid:0}.html${suffix}',-1,false);return false;"`,
                replacement:`onClick="Expander.make(this,'${c.listenOrigin}/users/${input.journal.username}/${input.page.kind==='entry'?input.page.ditemid:0}.html${suffix}',-1,false);return false;"`};
        })():null;
    const ctx = new Context(layers, text => {
        if (!printing) return;
        // Only the unchanged stock expand-all handler receives the named
        // transport-origin adaptation. The fallback href stays canonical.
        if(expansion)text=text.replaceAll(expansion.original,expansion.replacement);
        bytes += Buffer.byteLength(text);
        if (bytes > maxBytes) throw new Error("Render output limit");
        html += text;
    }, {
        SITEROOT: c.siteRoot, PALIMGROOT: c.palImgRoot, SITENAME: c.siteName,
        SITENAMESHORT: c.siteNameShort, SITENAMEABBREV: c.siteNameAbbrev,
        IMGDIR: c.imgPrefix, STYLES_IMGDIR: c.imgPrefix + "/styles", STATDIR: c.statPrefix,
    }, callbacks(page, host), text => finalized.has(text)?text:cleanTrustedSafeChunk(text, {
        href: String(page._stylesheet_url), decision: 1,
    }));
    // The pinned core2 stack has no core1 renamed properties. Group overrides
    // still come from compiled source defaults, never from a prepared fixture.
    for (const [key, value] of Object.entries(ctx.prop._grouped_property_override ?? {})) {
        if (typeof value !== "string") throw new Error("Invalid stock property override");
        if (ctx.prop["_" + value]) ctx.prop["_" + key] = ctx.prop["_" + value];
    }
    ctx.runFunction("prop_init()");
    // Perl autovivifies these nested array lvalues in modules_init. Provision
    // empty containers from live source defaults, then execute the unchanged
    // function which decides placement and order itself.
    const sections: Record<string, unknown[]> = Object.create(null);
    const section=():unknown[]=>new Proxy([], {set(target,key,value) {
        if(typeof key==='string'&&/^-?[0-9]+$/.test(key)) {
            let index=Number(key);
            if(!Number.isSafeInteger(index)||Math.abs(index)>10000)throw new Error('Module index limit');
            if(index<0)index+=target.length;
            if(index<0)throw new Error('Non-creatable module index');
            return Reflect.set(target,String(index),value);
        }
        return Reflect.set(target,key,value);
    }});
    for (const [key, value] of Object.entries(ctx.prop)) {
        if (/^_module_.*_section$/.test(key) && typeof value === "string") sections[value] ??= section();
    }
    for (const value of (ctx.prop._module_layout_sections ?? []) as string[]) sections[value] ??= section();
    ctx.prop._module_sections = sections;
    ctx.runFunction("modules_init()");
    for (const values of Object.values(sections)) {
        for (let i = 0; i < values.length; i++) values[i] ??= [];
    }
    escapeProperties(ctx, layers,content);
    // Preserve accessor aliases on the Page, because both generated S2 and
    // source-derived host helpers update/read the same underlying fields.
    const prepared=prepare(input, ctx, content);
    const customtextHtml=prepared._customtext_content;
    // Only a completed child-cleaner result is registered. Later Page mutations
    // cannot redefine membership, and other safe chunks retain the stock filter.
    if(typeof customtextHtml==='string'&&cleaned.has(customtextHtml))finalized.add(customtextHtml);
    Object.defineProperties(page, Object.getOwnPropertyDescriptors(prepared));
    Object.assign(host, hostData(input, page, ctx.prop._reg_firstdayofweek === "monday"));
    // core2 Comment::print_poster emits one complete safe chunk containing
    // the trusted app badge. Capture that exact prepared public chunk before
    // any printing; later mutable model strings cannot extend membership.
    const registerPosters=(comments:Record<string,any>[]):void=>{for(const comment of comments){
        if(comment._public_visible) {
            const poster=comment.poster;
            let label=poster&&!poster['.isnull']?host.user_badges[String(poster.host_userid)]:
                `<span class="anonymous">${ctx.prop._text_poster_anonymous}</span>`;
            if(typeof label!=='string')throw new Error('Missing trusted comment badge');
            if(comment.metadata.imported_from)label=`<span class="imported-from">${label} (${ctx.prop._text_openid_from} ${comment.metadata.imported_from})</span>`;
            finalized.add(`<span class="poster comment-poster"><span class="comment-from-text">${ctx.prop._text_comment_from}</span> ${label}`);
        }
        registerPosters(comment.replies);
    }};
    registerPosters(page.comments??[]);
    // Only the Entry branch's complete stock page-summary LI is authorized.
    // Evaluate unchanged helpers against the prepared roots now, so mutations
    // during printing cannot grant new bytes or authorize other module lists.
    if(input.page.kind==='entry')for(const comment of page.comments??[]) {
        if(comment.deleted||comment.fromsuspended||comment.screened_noshow)continue;
        const count=ctx.getFunction('print_module_pagesummary_comment_count(Comment)')(ctx,comment);
        const display=ctx.getFunction('print_module_pagesummary_comments(string,int,string,string)')(
            ctx,comment.subject,count,'text_read_comments_threads','');
        const poster=comment.poster;
        const label=poster&&!poster['.isnull']?host.user_badges[String(poster.host_userid)]:ctx.prop._text_poster_anonymous;
        if(typeof label!=='string'||typeof display!=='string')throw new Error('Missing trusted comment summary');
        let icon='';
        if(comment.admin_post) {
            const image=ctx.getFunction('get_image(string)')(ctx,'admin-post');
            icon=String(ctx.getMethod(image,'as_string(string)',layers[0]!,0)(ctx,image,ctx.prop._text_icon_alt_admin_post));
        }
        finalized.add(`<li class="module-list-item"><span class="pagesummary-poster">${label}</span> - <span class="pagesummary-subject">${icon}<a href="#${comment.anchor}" ${display}</li>\n`);
    }
    let metadata: ReturnType<RenderContentPreparation["metadata"]> | undefined;
    if (input.page.kind === "entry") {
        const ditemid = input.page.ditemid;
        const selected = input.journal.entries.filter(entry => entry.id === ditemid);
        if (selected.length !== 1) throw new Error("Missing entry metadata source");
        metadata = content.metadata(selected[0]!,
            `${input.journal.baseUrl}/${ditemid}.html`);
    }
    page._head_content = head(input, page, metadata);
    printing = true;
    ctx.runMethod(page, "print()");
    const ending = html.indexOf("</body>");
    if (ending < 0 || !html.includes("</html>")) throw new Error("Incomplete stock page");
    const footer = "<div id='statistics' style='text-align: left; font-size:0; line-height:0; height:0; overflow:hidden;'></div>";
    html = html.slice(0, ending) + footer + html.slice(ending);
    if (Buffer.byteLength(html) > maxBytes) throw new Error("Render output limit");
    return html;
}
