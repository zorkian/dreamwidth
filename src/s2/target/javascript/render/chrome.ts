// chrome.ts
//
// The site markup Perl adds around and inside S2 pages for an anonymous
// visitor: the control strip, user tags, the user link bar, and the CSS and
// JavaScript includes. Follows views/journal/controlstrip.tt, LJ::ljuser,
// DW::Logic::UserLinkBar and the LJ::need_res calls made for journal views.
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
import type { SiteConfig } from "../server/config";
import type { Site, User } from "../data/user";
import { type S2Object, Image, Link, ehtml, eurl, nullObject } from "./objects";
import type { Chrome } from "./state";

// Resource groups registered for journal views, in LJ::need_res order.
const CSS_LIBRARY = ["lj_base.css", "esn.css", "jquery/jquery.ui.core.css", "jquery/jquery.ui.tooltip.css",
    "jquery.contextualhover.css", "css/foundation/foundation_minimal.css"];
const CSS_RECENT = ["css/components/quick-reply.css", "css/components/icon-select.css",
    "css/components/imageshrink.css", "jquery/jquery.ui.theme.smoothness.css", "controlstrip.css",
    "controlstrip-COLOR.css", "jquery/jquery.ui.button.css", "jquery/jquery.ui.dialog.css", "canary.css"];
const CSS_ENTRY = ["css/components/quick-reply.css", "css/components/icon-select.css",
    "css/components/imageshrink.css", "jquery/jquery.ui.theme.smoothness.css", "jquery/jquery.ui.button.css",
    "jquery/jquery.ui.dialog.css", "jquery.commentmanage.css", "controlstrip.css", "controlstrip-COLOR.css",
    "canary.css"];
const JS_LIBRARY = ["jquery/jquery-1.8.3.js", "foundation/vendor/custom.modernizr.js",
    "foundation/foundation/foundation.js", "foundation/foundation/foundation.topbar.js", "dw/dw-core.js",
    "jquery/jquery.ui.core.js", "jquery/jquery.ui.widget.js", "jquery/jquery.ui.tooltip.js", "jquery.ajaxtip.js",
    "jquery/jquery.ui.position.js", "jquery.hoverIntent.js", "jquery.contextualhover.js"];
const JS_RECENT = ["jquery.esn.js", "jquery.replyforms.js", "jquery.poll.js", "journals/jquery.tag-nav.js",
    "jquery.mediaplaceholder.js", "jquery.imageshrink.js", "components/jquery.icon-select.js",
    "jquery.quickreply.js", "jquery.threadexpander.js", "jquery.cuttag-ajax.js", "jquery.default-editor.js",
    "jquery/jquery.ui.button.js", "jquery/jquery.ui.dialog.js"];
const JS_ENTRY = ["jquery.replyforms.js", "jquery.poll.js", "journals/jquery.tag-nav.js",
    "jquery.mediaplaceholder.js", "jquery.imageshrink.js", "components/jquery.icon-select.js",
    "jquery.quickreply.js", "jquery.threadexpander.js", "jquery/jquery.ui.button.js", "jquery/jquery.ui.dialog.js",
    "jquery.commentmanage.js", "jquery.esn.js"];

const mtimes = new Map<string, number>();

// LJ::determine_viewing_style for a logged-out viewer.
export function viewingStyle(args: Readonly<Record<string, string>>): string {
    if (args.format === "light") return "light";
    return ["light", "site", "mine", "original"].includes(args.style ?? "") ? args.style! : "original";
}

export interface ChromeRequest {
    readonly site: Site;
    readonly journal: User;
    // The view as the URL names it: "" for recent entries.
    readonly view: string;
    // The request path and query, for login return URLs.
    readonly requestPath: string;
    // The query arguments, with any tag or security filter from the path.
    readonly args: Readonly<Record<string, string>>;
    readonly showControlStrip: boolean;
    readonly users: ReadonlyMap<number, User>;
}

export function createChrome(request: ChromeRequest): Chrome & {
    resourceHead(): string;
    string(key: string): string;
} {
    const { site, journal } = request;
    const config = site.config;
    const origin = `${config.protocol}://${site.host}`;
    const string = (key: string) => config.strings[key] ?? "";
    const color = journal.props.control_strip_color || "dark";

    const lists = () => {
        const css = (request.view === "entry" ? CSS_ENTRY : CSS_RECENT)
            .filter(file => request.showControlStrip || !file.startsWith("controlstrip"))
            .map(file => file.replace("COLOR", color));
        return { css, js: request.view === "entry" ? JS_ENTRY : JS_RECENT };
    };
    const bundle = (prefix: "stc" | "js", files: readonly string[]) => {
        const version = Math.max(...files.map(file => resourceTime(config, prefix, file)));
        return `${prefix === "stc" ? config.statPrefix : config.jsPrefix}/??${files.join(",")}?v=${version}`;
    };

    // LJ::ljuser
    const ljuser = (userid: number, linkColor: string) => {
        const u = request.users.get(userid);
        return u ? ljuserTag(site, u, { linkColor }) : "";
    };

    const label = (id: string, css: string, text: string) =>
        `\n        <label for="${id}" class="${css}">\n            ${text}\n        </label>\n        `;
    const hidden = (name: string, value: string) => `<input type='hidden' name="${name}" value="${ehtml(value)}" />`;

    return {
        string,
        ljuser,
        controlStripUserpicCss: () => "",
        quickreplyDiv: () => "",
        replyForm: () => "",

        // views/journal/controlstrip.tt, logged-out branch
        controlStrip() {
            if (!request.showControlStrip) return "";
            const here = origin + request.requestPath;
            const login = `<form action="${config.siteRoot}/login" method="post" class="lj_login_form pkg">
    <div id="login-form">${hidden("lj_form_auth", "")}${hidden("returnto", here)}${label("login_user", "invisible", "Account name:")}` +
                '<input type="text" tabindex="1" id="login_user" aria-required="true" maxlength="27" default="" value="" ' +
                'class="text" name="user" size="7" placeholder="Username" />' +
                label("login_password", "invisible", "Password:") +
                '<input type="password" class="text" tabindex="2" name="password" size="7" id="login_password" ' +
                'aria-required="true" value="" placeholder="Password" />' +
                '<input type=\'submit\' value="Log in" class="submit" id="login_submit" tabindex="4" />' + `    </div>
    <div id="login-other">    <ul>
        <li><a href='${config.siteRoot}/lostinfo' >(Forgot it?)</a></li>
        <li><a href='${config.siteRoot}/openid/?returnto=${ehtml(here)}' >(OpenID?)</a></li>
    </ul>` + '<input type=\'checkbox\' class="checkbox" tabindex="3" name="remember_me" id="login_remember_me" value="1" />' +
                label("login_remember_me", "checkboxlabel", "Remember me") + `    </div>
</form>`;
            const search = `<div class='appwidget appwidget-search' id='LJWidget_1'>
<form action='${config.siteRoot}/multisearch' method='post'>
<input type="text" class="text" size="20" id="search" title="Search" name="q" value="" />
<select class="select" id="id-type-0" name="type">
<option value="int" selected='selected'>Interest</option>
<option value="region">Region</option>
<option value="nav_and_user">Site and Account</option>
<option value="faq">FAQ</option>
<option value="email">Email</option>
</select>
<input type='submit' value="Go" class="submit" />
</form></div><!-- end .appwidget-search -->
`;
            // LJ::control_strip's style links, through LJ::create_url with keep_args.
            const path = request.requestPath.split("?")[0];
            const styleLink = (style: string) => {
                const args: Record<string, string> = { ...request.args, style };
                const query = Object.keys(args).sort().map(key => `${eurl(key)}=${eurl(args[key]!)}`).join("&");
                return ehtml(`${origin}${path}?${query}`);
            };
            const current = viewingStyle(request.args);
            const styles = [
                current !== "site" && ["entry", "reply", "icons"].includes(request.view) ? ["site", "site"] : undefined,
                current !== "light" ? ["light", "light"] : undefined,
                current !== "original" ? ["original", "original"] : undefined,
            ].filter(option => option).map(option => `<a href='${styleLink(option![0]!)}'>${option![1]}</a>`)
                .join("&nbsp;&nbsp; ");
            const kind = journal.journaltype === "C" ? "community" : "journal";
            return `
<div id='lj_controlstrip'>

<div id='lj_controlstrip_loggedout_userpic'>

</div>
  <div id='lj_controlstrip_login'>${login}
  </div>
<div id='lj_controlstrip_actionlinks'>
  <span id='lj_controlstrip_statustext'>You're viewing ${ljuser(journal.userid, "")}'s ${kind}</span>
  <br /><a href='${config.siteRoot}/create'>Create a ${config.siteNameShort} Account</a>&nbsp;&nbsp;<a href='${config.siteRoot}/'>Learn More</a></div>

<div id='lj_controlstrip_search'>${search}
  Reload page in style:&nbsp;&nbsp;${styles}</div>

</div>
`;
        },

        // LJ::res_includes_head: the Site settings and stylesheets.
        resourceHead() {
            const settings = {
                cmax_comment: 16000, statprefix: config.statPrefix, user_domain: config.domain,
                currentJournal: journal.user, iconprefix: config.userpicRoot, ctx_popup: 1,
                imgprefix: config.imgPrefix, esn_async: 1, ctx_popup_userhead: 1, ctx_popup_icons: 1,
                media_embed_enabled: 1, inbox_update_poll: 1, siteroot: config.siteRoot,
                currentJournalBase: journal.journalBase(site), has_remote: 0,
            };
            return `
            <script type="text/javascript">
                var Site;
                if (!Site)
                    Site = {};

                Site = Object.assign(Site, ${JSON.stringify(settings)});
           </script>
        ` + [CSS_LIBRARY, lists().css].map(files =>
                `<link rel="stylesheet" type="text/css" href="${bundle("stc", files)}" />\n`).join("");
        },

        // LJ::S2::get_script_tags
        scriptTags() {
            let html = [JS_LIBRARY, lists().js].map(files =>
                `<script type="text/javascript" src="${bundle("js", files)}"></script>\n`).join("");
            if (request.showControlStrip) {
                const [pathname, query = ""] = request.requestPath.split("?");
                html += `
<script type='text/javascript'>
jQuery(function(jQ){
    if (jQ("#lj_controlstrip").length == 0) {
        jQ.getJSON("/${journal.user}/__rpc_controlstrip?user=${journal.user}&host=${site.host}&uri=${pathname}&args=${eurl(query)}&view=${request.view}", {},
            function(data) {
                jQ("<div></div>").html(data.control_strip).prependTo("body");
            }
        );
    }
})
</script>`;
            }
            return html + "<script>$(document).foundation();</script>";
        },

        // UserLite::get_link through DW::Logic::UserLinkBar, logged out.
        userLink(props, user, key) {
            const u = request.users.get(user.$userid);
            if (!u) return nullObject("Link");
            const link = userLinkBar(u, key, string);
            if (!link) return nullObject("Link");
            const caption = props._userlite_interaction_links === "text" ? link.text : link.title;
            const url = link.url ? `${config.siteRoot}/${link.url}` : "";
            return Link(url, caption, Image(`${config.imgPrefix}/silk/profile/${link.image}`, 20, 18, ""));
        },

        // LJ::S2::get_tags_text
        tagsText(props, tags: S2Object[]) {
            if (!tags.length) return "";
            const list = tags.map(tag => `<a rel='tag' href='${tag._url}'>${tag._name}</a>`).join(", ");
            return `<div class='ljtags'>${String(props._text_tags ?? "").replace("#", list)}</div>`;
        },
    };
}

export interface UserTagOptions {
    readonly linkColor?: string;
    readonly noLink?: boolean;
    readonly noLjuserClass?: boolean;
}

// LJ::ljuser
export function ljuserTag(site: Site, u: User, options: UserTagOptions = {}): string {
    const config = site.config;
    const staff = Number(u.getCap(config, "staff_headicon")) > 0;
    const [icon, size, alt] = u.journaltype === "C"
        ? staff ? ["comm_staff.png", 16, "site community"] : ["silk/identity/community.png", 16, "community"]
        : u.journaltype === "Y" ? ["silk/identity/feed.png", 16, "syndicated"]
            : staff ? ["silk/identity/user_staff.png", 17, "staff"] : ["silk/identity/user.png", 17, "personal"];
    const deleted = u.isVisible() ? "" : " text-decoration: line-through;";
    const style = /^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(options.linkColor ?? "")
        ? ` style='color: ${options.linkColor};'` : "";
    const base = u.journalBase(site);
    const img = `<img src='${config.imgPrefix}/${icon}' alt='[${alt} profile] ' width='${size}' height='${size}' ` +
        "style='vertical-align: text-bottom; border: 0; padding-right: 1px;' />";
    const attrs = options.noLjuserClass ? "" : ` lj:user='${u.user}'`;
    const cls = options.noLjuserClass ? "" : " class='ljuser'";
    return `<span${attrs} style='white-space: nowrap;${deleted}'${cls}>` +
        (options.noLink ? `${img}<b>${u.user}</b>` : `<a href='${base}/profile'>${img}</a><a href='${base}/'${style}><b>${u.user}</b></a>`) +
        "</span>";
}

interface BarLink {
    readonly text: string;
    readonly title: string;
    readonly image: string;
    readonly url?: string;
}

// DW::Logic::UserLinkBar for a logged-out visitor.
function userLinkBar(u: User, key: string, string: (key: string) => string): BarLink | undefined {
    const link = (text: string, title: string, image: string, url?: string): BarLink =>
        ({ text: string(text), title: string(title), image, ...(url ? { url } : {}) });
    const personal = u.journaltype === "P" || u.journaltype === "I";
    switch (key) {
        case "manage_membership":
            return u.journaltype === "C"
                ? link("userlinkbar.joincomm", "userlinkbar.joincomm.title.loggedout", "community_join_disabled.png")
                : undefined;
        case "trust":
            return personal
                ? link("userlinkbar.addtrust", "userlinkbar.addtrust.title.loggedout", "access_grant_disabled.png")
                : undefined;
        case "watch":
            return link("userlinkbar.addsub", "userlinkbar.addsub.title.loggedout", "subscription_add_disabled.png");
        case "post_entry":
            return u.journaltype === "C"
                ? link("userlinkbar.post", "userlinkbar.post.title.loggedout", "post_disabled.png")
                : undefined;
        case "message":
            return personal
                ? link("userlinkbar.sendmessage", "userlinkbar.sendmessage.title.loggedout", "message_disabled.png")
                : undefined;
        case "track": {
            const text = u.journaltype === "C" ? "userlinkbar.track" : u.journaltype === "Y" ? "userlinkbar.tracksyn"
                : "userlinkbar.trackuser";
            return link(text, "userlinkbar.trackuser.title.loggedout", "track_disabled.png");
        }
        case "memories":
            return link("userlinkbar.memories", "userlinkbar.memories.title.other", "memories.png",
                `tools/memories?user=${u.user}`);
        default:
            return undefined;
    }
}

function resourceTime(config: SiteConfig, prefix: string, file: string): number {
    const key = `${prefix}/${file}`;
    let time = mtimes.get(key);
    if (time === undefined) {
        time = Math.floor(statSync(path.join(config.home, "build/static", prefix, file)).mtimeMs / 1000);
        mtimes.set(key, time);
    }
    return time;
}
