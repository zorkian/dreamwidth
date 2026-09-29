// chrome.ts
//
// The site markup Perl adds around and inside S2 pages for an anonymous
// visitor: the control strip, user tags, the user link bar, and the script
// tags. Follows views/journal/controlstrip.tt, LJ::ljuser and
// DW::Logic::UserLinkBar.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { Site, User } from "../data/user";
import { type S2Object, Image, Link, ehtml, eurl, nullObject } from "./objects";
import type { Resources } from "./resources";
import type { Chrome } from "./state";

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
    readonly resources: Resources;
}

export function createChrome(request: ChromeRequest): Chrome & { string(key: string): string } {
    const { site, journal } = request;
    const config = site.config;
    const origin = `${config.protocol}://${site.host}`;
    const string = (key: string) => config.strings[key] ?? "";

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
            // LJ::control_strip's status for a logged-out viewer.
            const type = journal.journaltype;
            const status = type === "P" || type === "I"
                ? request.view === "read" ? "personalreadingpage" : request.view === "network" ? "personalnetworkpage" : "personal"
                : type === "C" ? "community" : type === "Y" ? "syn" : "other";
            const statusText = string(`web.controlstrip.status.${status}`).replaceAll("[[user]]", ljuser(journal.userid, ""));
            return `
<div id='lj_controlstrip'>

<div id='lj_controlstrip_loggedout_userpic'>

</div>
  <div id='lj_controlstrip_login'>${login}
  </div>
<div id='lj_controlstrip_actionlinks'>
  <span id='lj_controlstrip_statustext'>${statusText}</span>
  <br /><a href='${config.siteRoot}/create'>Create a ${config.siteNameShort} Account</a>&nbsp;&nbsp;<a href='${config.siteRoot}/'>Learn More</a></div>

<div id='lj_controlstrip_search'>${search}
  Reload page in style:&nbsp;&nbsp;${styles}</div>

</div>
`;
        },

        // LJ::S2::get_script_tags
        scriptTags() {
            let html = request.resources.includes("scripts");
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

