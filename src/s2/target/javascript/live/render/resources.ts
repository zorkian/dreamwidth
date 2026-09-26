// resources.ts
//
// Source-derived stock resource registration and public metadata.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/Web.pm resource registration/res_includes and LJ/S2.pm script tags.
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


import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { RenderInput } from "./types";

// Registration order and groups ported from LJ::Web resource bootstrap,
// LJ::S2::tracking_popup_js, LJ::Talk::init_s2journal_js and LJ::S2::generate_page.
// Only the pinned anonymous Foundation resource closure is supported.
export const CSS_LIBRARY = ["lj_base.css", "esn.css", "jquery/jquery.ui.core.css",
    "jquery/jquery.ui.tooltip.css", "jquery.contextualhover.css",
    "css/foundation/foundation_minimal.css"];
export const CSS_PAGE = ["css/components/quick-reply.css", "css/components/icon-select.css",
    "css/components/imageshrink.css", "jquery/jquery.ui.theme.smoothness.css",
    "controlstrip.css", "controlstrip-dark.css", "jquery/jquery.ui.button.css",
    "jquery/jquery.ui.dialog.css", "canary.css"];
export const CSS_ENTRY = ["css/components/quick-reply.css", "css/components/icon-select.css",
    "css/components/imageshrink.css", "jquery/jquery.ui.theme.smoothness.css",
    "jquery/jquery.ui.button.css", "jquery/jquery.ui.dialog.css", "jquery.commentmanage.css",
    "controlstrip.css", "controlstrip-dark.css", "canary.css"];
export const JS_LIBRARY = ["jquery/jquery-1.8.3.js", "foundation/vendor/custom.modernizr.js",
    "foundation/foundation/foundation.js", "foundation/foundation/foundation.topbar.js", "dw/dw-core.js",
    "jquery/jquery.ui.core.js", "jquery/jquery.ui.widget.js", "jquery/jquery.ui.tooltip.js",
    "jquery.ajaxtip.js", "jquery/jquery.ui.position.js", "jquery.hoverIntent.js", "jquery.contextualhover.js"];
export const JS_PAGE = ["jquery.esn.js", "jquery.replyforms.js", "jquery.poll.js",
    "journals/jquery.tag-nav.js", "jquery.mediaplaceholder.js", "jquery.imageshrink.js",
    "components/jquery.icon-select.js", "jquery.quickreply.js", "jquery.threadexpander.js",
    "jquery.cuttag-ajax.js", "jquery.default-editor.js",
    "jquery/jquery.ui.button.js", "jquery/jquery.ui.dialog.js"];
export const JS_ENTRY = ["jquery.replyforms.js", "jquery.poll.js",
    "journals/jquery.tag-nav.js", "jquery.mediaplaceholder.js", "jquery.imageshrink.js",
    "components/jquery.icon-select.js", "jquery.quickreply.js", "jquery.threadexpander.js",
    "jquery/jquery.ui.button.js", "jquery/jquery.ui.dialog.js", "jquery.commentmanage.js",
    "jquery.esn.js"];

export function loadResourceTimes(): Readonly<Record<string, number>> {
    const root = resolve(__dirname, "../../../../../../../build/static");
    const values: Record<string, number> = Object.create(null);
    for (const [prefix, paths] of [["stc", [...CSS_LIBRARY, ...CSS_PAGE, ...CSS_ENTRY,
        "controlstrip-light.css"]], ["js", [...JS_LIBRARY, ...JS_PAGE, ...JS_ENTRY]]] as const) {
        for (const path of paths) {
            values[prefix + "/" + path] = Math.floor(statSync(resolve(root, prefix, path)).mtimeMs / 1000);
        }
    }
    return Object.freeze(values);
}
function lists(input: RenderInput): [string[], string[]] {
    const css = (input.page.kind === "entry" ? CSS_ENTRY : CSS_PAGE)
        .filter(path => input.journal.showControlStrip || !path.startsWith("controlstrip"));
    return [css.map(path => path === "controlstrip-dark.css"
        ? `controlstrip-${input.journal.controlStripColor}.css` : path),
    input.page.kind === "entry" ? JS_ENTRY : JS_PAGE];
}
function bundle(input: RenderInput, prefix: string, files: readonly string[]): string {
    const max = Math.max(...files.map(path => {
        const time = input.resourceTimes[prefix + "/" + path];
        if (!Number.isSafeInteger(time) || time! <= 0) throw new Error("Missing resource metadata");
        return time!;
    }));
    const urlPrefix = prefix === "stc" ? input.config.statPrefix : input.config.jsPrefix;
    return `${urlPrefix}/??${files.join(",")}?v=${max}`;
}
export function resourceHead(input: RenderInput, base: string): string {
    const c = input.config;
    // LJ::Web Site JSON hash order under the controlled PERL_HASH_SEED=0 /
    // PERL_PERTURB_KEYS=0 oracle. Values are live source-derived public fields;
    // another Perl hash seed can serialize these same fields in another order.
    const site = {
        cmax_comment: 16000, statprefix: c.statPrefix, user_domain: c.userDomain,
        currentJournal: input.journal.username, iconprefix: c.userpicRoot, ctx_popup: 1,
        imgprefix: c.imgPrefix, esn_async: 1, ctx_popup_userhead: 1, ctx_popup_icons: 1,
        media_embed_enabled: 1, inbox_update_poll: 1, siteroot: c.siteRoot,
        currentJournalBase: base, has_remote: 0,
    };
    return `
            <script type="text/javascript">
                var Site;
                if (!Site)
                    Site = {};

                Site = Object.assign(Site, ${JSON.stringify(site)});
           </script>
        ` + [CSS_LIBRARY, lists(input)[0]].map(files =>
        `<link rel="stylesheet" type="text/css" href="${bundle(input, "stc", files)}" />\n`).join("");
}
export function resourceBody(input: RenderInput): string {
    const c = input.config;
    const u = input.journal.username;
    let html = [JS_LIBRARY, lists(input)[1]].map(files =>
        `<script type="text/javascript" src="${bundle(input, "js", files)}"></script>\n`).join("");
    if (input.journal.showControlStrip) html += `
<script type='text/javascript'>
jQuery(function(jQ){
    if (jQ("#lj_controlstrip").length == 0) {
        jQ.getJSON("/${u}/__rpc_controlstrip?user=${u}&host=${new URL(c.canonicalAppOrigin).host}&uri=/users/${u}/${input.page.kind === "entry" ? input.page.ditemid + ".html" : ""}&args=${input.skipPresent ? "skip%3D" + input.skip : ""}&view=${input.page.kind === "entry" ? "entry" : ""}", {},
            function(data) {
                jQ("<div></div>").html(data.control_strip).prependTo("body");
            }
        );
    }
})
</script>`;
    return html + "<script>$(document).foundation();</script>";
}
