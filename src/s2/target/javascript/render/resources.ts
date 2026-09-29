// resources.ts
//
// The CSS and JavaScript a journal page includes, following LJ::need_res,
// LJ::res_includes and the resources registered for every request by
// LJ::register_standard_resources.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { statSync } from "node:fs";
import path from "node:path";
import type { Site, User } from "../data/user";
import type { SiteConfig } from "../server/config";

// $LJ::LIB_RES_PRIORITY
const LIBRARY = 3;

// Journal pages use the foundation group, as LJ::S2::make_journal sets it.
const ACTIVE_GROUP = "foundation";

interface NeedOptions {
    readonly group?: string;
    readonly priority?: number;
}

const mtimes = new Map<string, number>();

export class Resources {
    private readonly byPriority: [string, string][][] = [];
    private readonly seen = new Set<string>();

    constructor(private readonly config: SiteConfig) {}

    // LJ::need_res
    need(options: NeedOptions, ...keys: string[]): void {
        const priority = options.priority ?? 0;
        for (const key of keys) {
            const group = options.group ?? (key.startsWith("js") ? "default" : "all");
            if (this.seen.has(`${group}-${key}`)) continue;
            this.seen.add(`${group}-${key}`);
            (this.byPriority[priority] ??= []).push([group, key]);
        }
    }

    // LJ::res_includes: stylesheet links for the head, or script tags for the body.
    includes(kind: "stylesheets" | "scripts"): string {
        const lists = new Map<string, string[][]>();
        const newest = new Map<string, number[]>();
        const included = new Set<string>();
        let order = 0;
        for (const rows of [...this.byPriority].reverse()) {
            if (!rows) continue;
            order++;
            for (const [group, key] of rows) {
                if (group !== "all" && group !== ACTIVE_GROUP) continue;
                const match = /^js\/(.+)/.exec(key) ?? /^stc\/(.+\.css)$/.exec(key);
                if (!match || included.has(match[1]!)) continue;
                included.add(match[1]!);
                const type = key.startsWith("js/") ? "js" : "css";
                if (!lists.has(type)) lists.set(type, []);
                if (!newest.has(type)) newest.set(type, []);
                (lists.get(type)![order] ??= []).push(match[1]!);
                newest.get(type)![order] = Math.max(newest.get(type)![order] ?? 0, this.modtime(key));
            }
        }
        const type = kind === "stylesheets" ? "css" : "js";
        return (lists.get(type) ?? []).map((files, index) => {
            if (!files) return "";
            const href = `${type === "css" ? this.config.statPrefix : this.config.jsPrefix}/??${files.join(",")}` +
                `?v=${newest.get(type)![index] || ""}`;
            return type === "css"
                ? `<link rel="stylesheet" type="text/css" href="${href}" />\n`
                : `<script type="text/javascript" src="${href}"></script>\n`;
        }).join("");
    }

    // LJ::_file_modtime; a missing file adds nothing to the version.
    private modtime(key: string): number {
        let time = mtimes.get(key);
        if (time === undefined) {
            const stat = statSync(path.join(this.config.staticDocs, key), { throwIfNoEntry: false });
            time = stat ? Math.floor(stat.mtimeMs / 1000) : 0;
            mtimes.set(key, time);
        }
        return time;
    }
}

// LJ::register_standard_resources, for the resources an anonymous journal
// page can use.
export function standardResources(config: SiteConfig): Resources {
    const res = new Resources(config);
    const lib = { priority: LIBRARY };
    res.need({ ...lib, group: "foundation" }, "js/jquery/jquery-1.8.3.js");
    res.need({ ...lib, group: "foundation" }, "js/foundation/vendor/custom.modernizr.js",
        "js/foundation/foundation/foundation.js", "js/foundation/foundation/foundation.topbar.js", "js/dw/dw-core.js");
    res.need(lib, "js/6alib/core.js", "js/6alib/dom.js", "js/6alib/httpreq.js", "js/livejournal.js");
    res.need({ ...lib, group: "all" }, "stc/lj_base.css");
    if (config.enabled.esn_ajax) res.need(lib, "js/esn.js", "stc/esn.css");
    res.need({ ...lib, group: "foundation" }, "js/jquery/jquery.ui.core.js", "js/jquery/jquery.ui.widget.js",
        "js/jquery/jquery.ui.tooltip.js", "js/jquery.ajaxtip.js", "js/jquery/jquery.ui.position.js",
        "stc/jquery/jquery.ui.core.css", "stc/jquery/jquery.ui.tooltip.css", "js/jquery.hoverIntent.js",
        "js/jquery.contextualhover.js", "stc/jquery.contextualhover.css");
    return res;
}

// LJ::S2::tracking_popup_js
export function trackingPopup(res: Resources, config: SiteConfig): void {
    if (!config.enabled.esn_ajax) return;
    res.need({ group: "all" }, "js/jquery/jquery.ui.core.js", "js/jquery/jquery.ui.widget.js",
        "js/jquery/jquery.ui.tooltip.js", "js/jquery.ajaxtip.js", "js/jquery/jquery.ui.position.js",
        "stc/jquery/jquery.ui.core.css", "stc/jquery/jquery.ui.tooltip.css", "js/jquery.esn.js");
}

// LJ::Talk::init_s2journal_js for a logged-out viewer.
export function journalScripts(res: Resources, options: { lastn?: boolean; noqr?: boolean } = {}): void {
    const all = { group: "all" };
    res.need(all, "js/jquery/jquery.ui.widget.js", "js/jquery.replyforms.js", "stc/css/components/quick-reply.css",
        "stc/css/components/icon-select.css", "js/jquery.poll.js", "js/journals/jquery.tag-nav.js",
        "js/jquery.mediaplaceholder.js", "js/jquery.imageshrink.js", "js/components/jquery.icon-select.js",
        "stc/css/components/imageshrink.css");
    if (options.noqr) {
        res.need(all, "js/jquery.talkform.js", "stc/css/components/talkform.css");
    } else {
        res.need(all, "js/jquery/jquery.ui.core.js", "stc/jquery/jquery.ui.core.css", "js/jquery/jquery.ui.widget.js",
            "js/jquery.quickreply.js", "js/jquery.threadexpander.js");
    }
    res.need(all, "stc/jquery/jquery.ui.theme.smoothness.css");
    if (options.lastn) res.need(all, "js/jquery/jquery.ui.widget.js", "js/jquery.cuttag-ajax.js", "js/jquery.default-editor.js");
}

// What LJ::S2::make_journal adds once the page is built.
export function journalResources(res: Resources, journal: User, showControlStrip: boolean): void {
    res.need({ priority: LIBRARY, group: "foundation" }, "stc/css/foundation/foundation_minimal.css");
    if (showControlStrip) {
        // The control_strip_stylesheet_link hook in DW::Hooks::NavStrip.
        res.need({}, "stc/controlstrip.css", `stc/controlstrip-${journal.props.control_strip_color || "dark"}.css`);
    }
    res.need({ group: "all" }, "js/jquery/jquery.ui.core.js", "js/jquery/jquery.ui.widget.js",
        "js/jquery/jquery.ui.tooltip.js", "js/jquery/jquery.ui.button.js", "js/jquery/jquery.ui.dialog.js",
        "js/jquery/jquery.ui.position.js", "js/jquery.ajaxtip.js", "stc/jquery/jquery.ui.core.css",
        "stc/jquery/jquery.ui.tooltip.css", "stc/jquery/jquery.ui.button.css", "stc/jquery/jquery.ui.dialog.css",
        "stc/jquery/jquery.ui.theme.smoothness.css", "stc/canary.css");
}

// The Site settings LJ::res_includes gives scripts.
export function siteSettings(site: Site, journal: User): string {
    const { config } = site;
    const flag = (on: boolean) => on ? 1 : "";
    const settings = {
        cmax_comment: 16000, statprefix: config.statPrefix, user_domain: config.userDomain,
        currentJournal: journal.user, iconprefix: config.userpicRoot, ctx_popup: 1,
        imgprefix: config.imgPrefix, esn_async: flag(config.enabled.esn_ajax), ctx_popup_userhead: 1,
        ctx_popup_icons: 1, media_embed_enabled: flag(config.enabled.embed_module),
        inbox_update_poll: flag(config.enabled.inbox_update_poll), siteroot: config.siteRoot,
        currentJournalBase: journal.journalBase(site), has_remote: 0,
    };
    return `
            <script type="text/javascript">
                var Site;
                if (!Site)
                    Site = {};

                Site = Object.assign(Site, ${JSON.stringify(settings)});
           </script>
        `;
}
