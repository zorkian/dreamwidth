// host.ts
//
// Application-owned helper ports for the anonymous stock page.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/S2.pm metadata/ljuser, LJ/HTMLControls.pm form serialization.
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


// Template portions: views/journal/controlstrip.tt
// Authors:
//     Nick Fagerlund <nick.fagerlund@gmail.com>
// Copyright (c) 2019 by Dreamwidth Studios, LLC.
// FormHTML portions: cgi-bin/DW/Template/Plugin/FormHTML.pm
// Authors:
//     Afuna <coder.dw@afunamatata.com>
// Copyright (c) 2011-2013 by Dreamwidth Studios, LLC.
// These independently licensed template/FormHTML portions remain free software;
// you may redistribute and/or modify them under the same terms as Perl itself.
// For a copy of the license, please reference 'perldoc perlartistic' or
// 'perldoc perlgpl'. The inherited LJ ports above retain their GPL terms.
// Related source templates: views/components/login.tt, views/widget/search.tt.
//

import type { RenderContentPreparation, RenderInput } from "./types";
import { S2Object, object } from "./objects";
import { escapeHtml } from "./builtins";
import { resourceBody, resourceHead } from "./resources";
import {prepareTagDetail} from "./prepare";
import { calendar } from "./calendar";

// These ports follow the anonymous branches of views/journal/controlstrip.tt,
// views/components/login.tt, views/widget/search.tt, FormHTML and HTMLControls.
// Text is the shipped en_DW text; input values are separately admitted/escaped.
function label(id: string, css: string, text: string): string {
    return `
        <label for="${id}" class="${css}">
            ${text}
        </label>
        `;
}
function hidden(name: string, value: string): string {
    return `<input type='hidden' name="${name}" value="${escapeHtml(value)}" />`;
}
export function badge(input: RenderInput): string {
    const u = input.journal.username;
    const base = input.journal.baseUrl;
    return `<span lj:user='${u}' style='white-space: nowrap;' class='ljuser'>` +
        `<a href='${base}/profile'><img src='${input.config.imgPrefix}/silk/identity/user.png' ` +
        "alt='[personal profile] ' width='17' height='17' " +
        "style='vertical-align: text-bottom; border: 0; padding-right: 1px;' /></a>" +
        `<a href='${base}/'><b>${u}</b></a></span>`;
}
export function controlStrip(input: RenderInput): string {
    if (!input.journal.showControlStrip) return "";
    const c = input.config;
    const current = `${c.canonicalAppOrigin}/users/${input.journal.username}/` +
        (input.page.kind === "entry" ? `${input.page.ditemid}.html` :
            input.skipPresent ? `?skip=${input.skip}` : "");
    // FormHTML/HTMLControls serialize hash attributes. This explicit order
    // matches the controlled PERL_HASH_SEED=0 / PERL_PERTURB_KEYS=0 comparison;
    // source template fields and live values remain independently constructed.
    const username = '<input type="text" tabindex="1" id="login_user" aria-required="true" ' +
        'maxlength="27" default="" value="" class="text" name="user" size="7" placeholder="Username" />';
    const password = '<input type="password" class="text" tabindex="2" name="password" size="7" ' +
        'id="login_password" aria-required="true" value="" placeholder="Password" />';
    const submit = '<input type=\'submit\' value="Log in" class="submit" id="login_submit" tabindex="4" />';
    const checkbox = '<input type=\'checkbox\' class="checkbox" tabindex="3" name="remember_me" ' +
        'id="login_remember_me" value="1" />';
    const login = `<form action="${c.siteRoot}/login" method="post" class="lj_login_form pkg">
    <div id="login-form">${hidden("lj_form_auth", input.formChallenge)}${hidden("returnto", current)}${label("login_user", "invisible", "Account name:")}${username}${label("login_password", "invisible", "Password:")}${password}${submit}    </div>
    <div id="login-other">    <ul>
        <li><a href='${c.siteRoot}/lostinfo' >(Forgot it?)</a></li>
        <li><a href='${c.siteRoot}/openid/?returnto=${escapeHtml(current)}' >(OpenID?)</a></li>
    </ul>${checkbox}${label("login_remember_me", "checkboxlabel", "Remember me")}    </div>
</form>`;
    const search = `<div class='appwidget appwidget-search' id='LJWidget_1'>
<form action='${c.siteRoot}/multisearch' method='post'>
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
    const light = input.page.kind === "entry" ? `${current}?style=light` :
        `${c.canonicalAppOrigin}/users/${input.journal.username}/?` +
        (input.skipPresent ? `skip=${input.skip}&amp;` : "") + "style=light";
    const styleLinks = input.page.kind === "entry"
        ? `<a href='${current}?style=site'>site</a>&nbsp;&nbsp; <a href='${light}'>light</a>`
        : `<a href='${light}'>light</a>`;
    return `
<div id='lj_controlstrip'>

<div id='lj_controlstrip_loggedout_userpic'>
  ${""}
</div>
  <div id='lj_controlstrip_login'>${login}
  </div>
<div id='lj_controlstrip_actionlinks'>
  <span id='lj_controlstrip_statustext'>You're viewing ${badge(input)}'s journal</span>
  <br /><a href='${c.siteRoot}/create'>Create a ${c.siteNameShort} Account</a>&nbsp;&nbsp;<a href='${c.siteRoot}/'>Learn More</a></div>

<div id='lj_controlstrip_search'>${search}
  Reload page in style:&nbsp;&nbsp;${styleLinks}</div>

</div>
`;
}
export function head(input: RenderInput, page: S2Object,
    metadata?: ReturnType<RenderContentPreparation["metadata"]>): string {
    if (input.page.kind === "entry") return entryHead(input, metadata);
    const { config: c, journal: j } = input;
    const base = j.baseUrl;
    let html = '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n';
    for (const type of ["rss", "atom"]) html +=
        `<link rel="alternate" type="application/${type === "rss" ? "rss+xml" : "atom+xml"}" ` +
        `title="${type === "rss" ? "RSS" : "Atom"}: all entries" href="${base}/data/${type}" />\n`;
    html += `<link rel="service" type="application/atomsvc+xml" title="AtomAPI service document" href="${c.siteRoot}/interface/atom" />\n` +
        `<link rel="openid.server" href="${c.siteRoot}/openid/server" />\n` +
        `<link rel="help" href="${c.siteRoot}/support/faq" />\n`;
    if (c.appleTouchIcon) html += `<link rel="apple-touch-icon" href="${c.appleTouchIcon}" />\n`;
    if (c.facebookPreviewIcon) html += `<meta property="og:image" content="${c.facebookPreviewIcon}"/>\n`;
    html += '<meta property="og:image:width" content="363"/>\n' +
        '<meta property="og:image:height" content="363"/>\n' +
        `<link rel="group friends made" title="${c.siteNameShort} friends" href="${base}/read" />\n`;
    if (j.blockRobots || input.skip) html += '<meta name="robots" content="noindex, nofollow, noarchive" />\n' +
        '<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />\n';
    html += `
  <script type='text/javascript'>
  expanded = 'Collapse';
  collapsed = 'Expand';
  collapseAll = 'Collapse All Cut Tags';
  expandAll = 'Expand All Cut Tags';
  </script>
    `;
    if (input.skip) html += `<link rel="next" href="${page.nav._forward_url}" />\n`;
    if (page.nav._backward_count) html += `<link rel="prev" href="${page.nav._backward_url ?? ""}" />\n`;
    return html + resourceHead(input, base);
}

export function entryOgDescription(eventText: string): string {
    // LJ::EntryPage first collapses byte-string ASCII whitespace, then
    // LJ::text_trim strips both edges before and after the 300 UTF-8 scalar
    // limit. Entity spelling remains literal until this final ehtml call.
    const collapsed = eventText.replace(/[ \t\r\n\f\v]+/g, " ").replace(/^ +| +$/g, "");
    return escapeHtml([...collapsed].slice(0, 300).join("").replace(/^ +| +$/g, ""));
}

function entryHead(input: RenderInput,
    metadata?: ReturnType<RenderContentPreparation["metadata"]>): string {
    if (!metadata || metadata.kind !== "inert-entry-metadata" ||
        input.page.kind !== "entry") throw new Error("Missing inert entry metadata");
    const {config: c, journal: j} = input;
    const ditemid = input.page.ditemid;
    const base = j.baseUrl;
    const url = `${base}/${ditemid}.html`;
    // EntryPage.pm derives OpenGraph from event_text, not the displayed body.
    // text_trim trims again after its 300 UTF-8 character limit; the worker's
    // inert helper string is escaped exactly once at this attribute boundary.
    const description = entryOgDescription(metadata.eventText);
    let html = `<meta property="og:title" content="${escapeHtml((metadata.subjectText && metadata.subjectText !== "0" ? metadata.subjectText : "(no subject)"))}"/>\n` +
        '<meta property="og:type" content="article"/>\n' +
        `<meta property="og:url" content="${escapeHtml(url)}"/>\n` +
        `<meta property="og:site_name" content="${escapeHtml(c.siteName)}"/>\n` +
        `<meta property="og:description" content="${description}"/>\n`;
    const selected = j.entries.filter(entry => entry.id === ditemid);
    if (selected.length !== 1) throw new Error("Invalid entry metadata identity");
    if (selected[0]!.userpic) {
        const picture = selected[0]!.userpic;
        html += `<meta property="og:image" content="${escapeHtml(c.userpicRoot + "/" + picture.picid + "/" + j.userid)}"/>\n` +
            '<meta property="og:image:width" content="100"/>\n' +
            '<meta property="og:image:height" content="100"/>\n';
    }
    html += `<meta property="article:published_time" content="${selected[0]!.eventtime.replace(" ", "T")}"/>\n` +
        `<meta property="article:author" content="${escapeHtml(base + "/profile")}"/>\n`;
    html += '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n' +
        `<link rel="help" href="${c.siteRoot}/support/faq" />\n`;
    if (c.appleTouchIcon) html += `<link rel="apple-touch-icon" href="${c.appleTouchIcon}" />\n`;
    if (c.facebookPreviewIcon) html += `<meta property="og:image" content="${c.facebookPreviewIcon}"/>\n`;
    html += '<meta property="og:image:width" content="363"/>\n' +
        '<meta property="og:image:height" content="363"/>\n';
    if (j.blockRobots) html += '<meta name="robots" content="noindex, nofollow, noarchive" />\n' +
        '<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />\n';
    html += '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n';
    for (const dir of ["prev", "next"]) html +=
        `<link rel="${dir}" href="${c.canonicalAppOrigin}/go?dir=${dir}&itemid=${ditemid}&journal=${j.username}" />\n`;
    html += `<link rel="canonical" href="${url}" />\n`;
    const cmtinfo = {journal: j.username, form_auth: input.formChallenge,
        remote: "", canSpam: 1, canAdmin: null};
    html += '<script>\n// don\'t crawl this.  read http://www.livejournal.com/developer/exporting\n' +
        `var LJ_cmtinfo = ${JSON.stringify(cmtinfo)}\n</script>`;
    return html + resourceHead(input, base);
}
export function hostData(input: RenderInput, page: S2Object, monday: boolean): S2Object {
    const c = input.config;
    const base = input.journal.baseUrl;
    const image = (path: string, alt: string) => object("Image", {
        url: `${c.imgPrefix}/${path}`, width: 16, height: 16, alttext: alt, extra: {}});
    const disabled = (path: string, text: string, title: string) => ({
        image: `${c.imgPrefix}/silk/profile/${path}.png`, width: 20, height: 18, text, title, url: "",
    });
    // DW::Logic::UserLinkBar anonymous personal-account branches, en.dat text.
    const userLinks = {
        trust: disabled("access_grant_disabled", "Grant Access", "You must be logged in to grant access to this account"),
        watch: disabled("subscription_add_disabled", "Subscribe", "You must be logged in to subscribe to this account"),
        track: disabled("track_disabled", "Track Account", "You must be logged in to manage notifications"),
        message: disabled("message_disabled", "Private Message", "You must be logged in to send a private message to this account"),
    };
    return {
        owner_user: input.journal.username, owner_userid: input.journal.userid,
        siteroot: c.siteRoot, app_origin: c.canonicalAppOrigin,
        control_strip_html: controlStrip(input), script_tags_html: resourceBody(input),
        ljuser_html: badge(input), visible_tags: input.journal.sidebarTags.map(tag=>prepareTagDetail(tag,input.journal.baseUrl)), user_links: userLinks, quickreply_div: "",
        viewer_sees_control_strip: input.journal.showControlStrip,
        has_quickreply: true, s2quickreply: true, comments_need_access: false,
        memories_enabled: true, tellafriend_enabled: true,
        entry_can_tell_friend: Object.fromEntries(input.journal.entries.map(e => [e.id, true])),
        calendar_month: calendar(input, base, monday),
        admin_post_image: image("silk/entry/admin_post.png", ""),
        memadd_image: image("silk/entry/memories_add.png", "Add to Memories"),
        tellfriend_image: image("silk/entry/tellafriend.png", "Tell someone about this!"),
        prev_entry_image: image("silk/entry/previous.png", "Previous Entry"),
        next_entry_image: image("silk/entry/next.png", "Next Entry"),
    };
}
