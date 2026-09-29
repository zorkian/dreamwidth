// reply-page.ts
//
// Build the S2 ReplyPage and its reply form, following LJ::S2::ReplyPage and
// LJ::Talk::talkform with views/journal/talkform.tt, for a logged-out viewer.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { createHash, randomInt } from "node:crypto";
import { commentProps, commentRows, commentTexts } from "../data/comment";
import { type Databases, int, text } from "../data/db";
import { type Entry, truthy } from "../data/entry";
import { User } from "../data/user";
import { pageEntry } from "./entry-page";
import {
    type S2Object, DateTimeUnix, ImageUserpic, UserLite, ehtml, s2, styleArgs, styleOpts, talkargs,
} from "./objects";
import { type PageContext, Page, journalDefaultPic, loadUserpics, robotMetaTags } from "./pages";
import { type RenderResult, plainError } from "./render";
import { journalScripts, trackingPopup } from "./resources";

interface Parent {
    readonly talkid: number;
    readonly subject: string;
}

// `uniq` identifies the visitor's browser, which the form's auth token is tied to.
// Null when there is no such page, or none the visitor may see.
export async function ReplyPage(pc: PageContext, entry: Entry, uniq: string):
    Promise<S2Object | { response: RenderResult } | null> {
    const { site, journal, db, args } = pc;
    const config = site.config;
    const s2entry = await pageEntry(pc, entry);
    if (!s2entry) return null;
    if (journal.statusvis === "O" || truthy(journal.getCap(config, "readonly"))) {
        return {
            response: plainError(403, "<h1>Read-Only User</h1><p>This journal is read-only.  You cannot comment in it.</p>"),
        };
    }

    const page = await Page(pc, "reply", await journalDefaultPic(pc));
    page[".type"] = "ReplyPage";
    const replytoid = Math.trunc(parseFloat(args.replyto ?? "")) || 0;
    const permalink = entry.url(site);
    let head = page._head_content +
        `<link rel="canonical" href="${permalink}${replytoid ? `?thread=${replytoid}#cmt${replytoid}` : ""}" />\n` +
        `\n<script type="text/javascript" src="${config.jsPrefix}/md5.js"></script>\n`;
    trackingPopup(pc.resources, config);
    journalScripts(pc.resources, { noqr: true, siteskin: pc.siteviews });
    const entryAdult = entry.adultContentCalculated() ?? "";
    if (journal.shouldBlockRobots(config) || config.robotBlockingContent.includes(entryAdult)) head += robotMetaTags();
    page._entry = s2entry;
    page._head_content = head;

    let replyto: S2Object = s2entry;
    let parent: Parent | undefined;
    if (replytoid) {
        const talkid = replytoid >> 8;
        if (replytoid % 256 !== entry.anum) return null;
        const row = (await commentRows(db, journal, entry.jitemid)).get(talkid);
        // Comments the visitor cannot see are answered as ones that do not exist.
        if (!row || row.state === "D" || row.state === "S") return null;
        const poster = row.posterid ? (await User.byIds(db, [row.posterid])).get(row.posterid) : undefined;
        if (poster?.statusvis === "S") return null;
        // Frozen threads show as frozen to everyone.
        if (row.state === "F") {
            return { response: { status: 403, body: "<p>This thread has been frozen; no more replies are allowed.</p>" } };
        }

        const [texts, props] = await Promise.all([commentTexts(db, journal, [talkid]), commentProps(db, journal, [talkid])]);
        const subject = texts.get(talkid)?.subject ?? "", body = texts.get(talkid)?.body ?? "";
        const cprops = props.get(talkid) ?? {};
        let userpic: S2Object | undefined;
        if (poster) {
            pc.users.set(poster.userid, poster);
            await loadUserpics(pc, [poster.userid]);
            const pics = pc.userpics.get(poster.userid)!;
            const keyword = poster.dversion >= 9
                ? (cprops.picture_mapid ? pics.keywordFromMapid(int(cprops.picture_mapid)) : undefined)
                : cprops.picture_keyword || undefined;
            userpic = ImageUserpic(config, poster, pics.get(pics.picidFromKeyword(keyword)), keyword);
        }
        await pc.content.preload(db, [body]);
        const style = styleArgs(args);
        // LJ::mysqldate_to_time reads the date as UTC.
        const time = DateTimeUnix(Date.parse(`${row.datepost.replace(" ", "T")}Z`) / 1000);
        const parentid = row.parenttalkid ? row.parenttalkid * 256 + entry.anum : 0;
        replyto = s2("Comment", {
            subject: ehtml(subject),
            text: pc.content.comment(body, cprops, row.datepost, !poster || poster.journaltype === "I"),
            userpic, poster: poster ? UserLite(site, poster) : undefined, journal: s2entry._journal, metadata: {},
            permalink_url: `${permalink}?thread=${replytoid}${style ? `&${style}` : ""}#cmt${replytoid}`,
            depth: 1,
            parent_url: parentid ? `${permalink}?thread=${parentid}${style ? `&${style}` : ""}#cmt${parentid}` : undefined,
            threadroot_url: `${config.siteRoot}/go?redir_type=threadroot&journal=${journal.user}&talkid=${replytoid}` +
                (style ? `&${style}` : ""),
            time, system_time: time, tags: [], talkid: replytoid,
            link_keyseq: ["edit_comment", "delete_comment", "screen_comment", "freeze_thread", "watch_thread",
                "unwatch_thread", "watching_parent"],
            screened: 0, frozen: 0, deleted: 0, full: 1, timeformat24: 0, admin_post: truthy(cprops.admin_post) ? 1 : 0,
        });
        parent = { talkid, subject };
    }
    page._replyto = replyto;
    // ReplyForm::print prints the form, which is made here as it needs the database.
    page._form = s2("ReplyForm", { $html: await talkform(pc, entry, parent, args.thread || "0", uniq) });
    page._isedit = 0;
    return page;
}

// LJ::Talk::talkform for a logged-out viewer, through the site's form helpers.
async function talkform(pc: PageContext, entry: Entry, parent: Parent | undefined, thread: string,
    uniq: string): Promise<string> {
    const { site, journal, db, args } = pc;
    const config = site.config;
    const string = (key: string, vars: Record<string, string> = {}) =>
        (config.strings[key.startsWith(".") ? `/journal/talkform.tt${key}` : key] ?? "")
            .replace(/\[\[(\w+)\]\]/g, (_, name) => vars[name] ?? "");

    if (journal.statusvis === "L") {
        return "Sorry, this journal is locked and comments cannot be posted to it or edited at this time.";
    }
    if (entry.replyCount() >= Number(journal.getCap(config, "maxcomments") ?? 0)) {
        return "Sorry, this entry already has the maximum number of comments allowed.";
    }

    const screening = await screeningLevel(pc, entry);
    const publicEntry = entry.security === "public";
    const allowsAnon = journal.optWhocanreply === "all";
    const allowsNonAccess = allowsAnon || journal.optWhocanreply === "reg";
    const isCommunity = journal.journaltype === "C";
    const logIps = journal.props.opt_logcommentips;
    const iplogging = !/^[NSA]$/.test(logIps ?? "") || logIps === "A" ? "all" : logIps === "S" ? "anon" : "";
    const defaultUsertype = allowsAnon ? "anonymous" : "user";

    const img = (name: string, extra = "") => {
        const image = config.images[name];
        return image ? `<img src="${config.imgPrefix}${image.src}" width="${image.width}" height="${image.height}" ` +
            `alt="${image.alt}" title="${image.alt}" border='0'${extra} />` : "";
    };
    const label = (id: string, text: string, css?: string) =>
        `<label for="${id}" ${css ? `class="${css}"` : ""}>\n            ${text}\n        </label>\n        `;
    const hidden = (fields: [string, string | number][]) =>
        fields.map(([name, value]) => `<input type='hidden' name="${name}" value="${ehtml(value)}" />`).join("");
    const checked = (on: boolean) => on ? " checked='checked'" : "";
    const willscreen = (key: string | false) => key ? string(key) : "";
    const anonOk = publicEntry && allowsAnon;
    const secret = await currentSecret(db);
    const now = Math.floor(Date.now() / 1000);
    const formAuth = challenge(secret, now, 86400, `${randChars(10)}-0-${uniq}`);
    const chal = `${entry.ditemid}-${journal.userid}-${secret.stime}-${randChars(20)}`;
    const chrp1 = `${chal}-${createHash("md5").update(secret.secret + chal).digest("hex")}`;

    let html = `<div id='qrdiv'><div id='qrformdiv'>

<form id="postform" name="postform" method="POST" action="${config.protocol}://${config.domainWeb || site.host}/talkpost_do">` +
        hidden([["lj_form_auth", formAuth]]) +
        hidden([["replyto", parent?.talkid ?? 0], ["parenttalkid", parent?.talkid ?? 0], ["itemid", entry.ditemid],
            ["journal", journal.user], ["editid", 0], ["viewing_thread", thread], ["chrp1", chrp1], ...styleOpts(args)]);

    html += `\n\n<div id="talkform-from">\n  <label>${string(".opt.from")}</label>`;
    html += `\n    <div class="from-option${anonOk ? "" : " from-option-cannot"}" id="from-anon">
      <input type='radio' name='usertype' value='anonymous' id='talkpostfromanon' ${
        anonOk ? (defaultUsertype === "anonymous" ? "checked='checked'" : "") : "disabled='disabled'"} />

      <label for='talkpostfromanon'${anonOk ? "" : ' class="disabled"'}>
        ${img("id_anonymous")}
        ${string(".opt.anonymous")}
      </label>`;
    if (anonOk) {
        if (screening) html += `\n          ${string(".opt.willscreen")}`;
    } else if (!publicEntry) {
        html += `\n          ${string(".opt.noanonpost.nonpublic")}`;
    } else if (!allowsNonAccess) {
        html += `\n          ${string(isCommunity ? ".opt.membersonly" : ".opt.friendsonly", { username: journal.user })}`;
    } else {
        html += `\n          ${string(".opt.noanonpost")}`;
    }
    const screensAll = screening === "A", screensNonAccess = screening === "F" || screening === "A";
    html += `\n    </div>
      <div class="from-option" id="from-openid-loggedout">
        <input type='radio' name='usertype' value='openid' data-more="from-openid-more" id='talkpostfromoidlo' />

        <label for='talkpostfromoidlo'>
          ${img("id_openid")}
          ${string(".opt.openid")}
        </label>
        ${willscreen(screensAll ? ".opt.willscreen" : screensNonAccess ? ".opt.willscreenfriend"
            : screening ? ".opt.willscreenopenid" : false)}
      </div>
    <div class="from-login" id="from-openid-more">
      <div>${label("oidurl", string(".login.url"))}<input type="text" value="" name="oidurl" class="text" id="oidurl" size="53" maxlength="60" />      </div>

      <div><input type='checkbox' name="oiddo_login" id="oidlogincheck" class="checkbox" />
        ${label("oidlogincheck", string(".loginq"), "checkboxlabel")}      </div>
    </div>

    <div class="from-option" id="from-user-loggedout">
      <input type='radio' name='usertype' value='user' data-more="from-user-more" id='talkpostfromlj'${checked(defaultUsertype === "user")} />

      <label for='talkpostfromlj'>
        ${img("id_user")}
        ${string(".opt.siteuser", { sitename: config.siteNameShort })}
      </label>${willscreen(screensAll ? ".opt.willscreen" : screensNonAccess ? ".opt.willscreenfriend" : false)}    </div>

    <div class="from-login" id="from-user-more">
      <div>${label("username", string("Username"))}<input type="text" style="background: url(&#39;${config.imgPrefix}/silk/identity/user.png&#39;) no-repeat; background-color: #fff; background-position: 0px 50%; padding-left: 18px; color: #00C; font-weight: bold;" value="" class="text" id="username" size="13" name="userpost" maxlength="${config.talkform.maxlengthUser}" />      </div>

      <div>${label("password", string("Password"))}<input type="password" id="password" class="text" size="18" name="password" maxlength="${config.talkform.maxlengthPass}" value="" />      </div>

      <div><input type='checkbox' id="logincheck" class="checkbox" name="do_login" />
        ${label("logincheck", string(".loginq"), "checkboxlabel")}      </div>
    </div>
      <span style='font-size: 8pt; font-style: italic;'>${string(".noaccount", { aopts: `href='${config.siteRoot}/create'` })}      </span></div>

<div class='qr-meta'>

</div>

`;

    let subject = "";
    if (parent?.subject) subject = `Re: ${parent.subject.replace(/^Re:\s*/i, "")}`;
    const icon = (id: string, extra: string) => config.talkform.subjecticons.find(icon => icon.id === id)?.html.replace("%s", extra) ?? "";
    const editors = config.talkform.editors;
    html += `
<div class="qr-subject">${label("subject", string(".opt.subject2"), "invisible")}<input type="text" value="${ehtml(subject)}" class="text" size="50" name="subject" id="subject" placeholder="${string(".opt.subject2")}" maxlength="100" /><input type='hidden' name="subjecticon" value="none" id="subjectIconField" />
  ${icon("none", "id='subjectIconImage' role='button' class='js-only' style='display: none;' title='Click to change the subject icon'")}</div>

<div style="display: none;" id="subjectIconList">
  <div class="subjecticon-grid">${config.talkform.subjecticons.map(i => `      <div>${icon(i.id, `id='${i.id}' role='button'`)}      </div>`).join("")}  </div>
</div>

<div id='ljnohtmlsubj' class='ljdeem no-js'><span style='font-size: 8pt; font-style: italic;'>${string(".nosubjecthtml")}</span></div>

<div class="qr-markup">
  <div class="qr-markup-type">${label("prop_editor", "Formatting type", "invisible")}<select class="select" id="prop_editor" name="prop_editor">
${editors.items.map(e => `<option value="${e.value}"${e.value === editors.selected ? " selected='selected'" : ""}>${e.text}</option>\n`).join("")}</select>
    <a href="${string("markup.helplink.url")}" tabindex="-1" target="_blank">${img("help",
        ` style="vertical-align: middle;" title="${string("markup.helplink.alttext")}"`).replace(/alt="[^"]*" title="[^"]*"/,
        `alt="${string("markup.helplink.alttext")}" title="${string("markup.helplink.alttext")}"`)}</a>
  </div>

  <div class="qr-markup-controls">
    <input type="button" id="comment-text-quote" value="Quote" tabindex="-1" class="js-only markup-button" style="display: none;" data-quote-error="${string("talk.error.quickquote")}" />
  </div>
</div>

<div class="qr-body">${label("body", string(".opt.message2"), "invisible")}<textarea wrap="soft" id="body" class="text" name="body" rows="10" cols="80"></textarea></div>

<div id="talkform-misc"></div>

<div class="qr-footer">
<input type='submit' name="submitpost" value="${string(".opt.submit")}" id="submitpost" class="submit" />  &nbsp;<input type='submit' name="submitpreview" value="${string("talk.btn.preview")}" id="submitpview" class="submit" /><input type='hidden' name="previewplaceholder" value="1" id="previewplaceholder" />`;
    if (iplogging) {
        html += `    <div class='de'>        ${string(iplogging === "all" ? ".logyourip" : ".loganonip")}    </div>`;
    }
    html += `    <div class='de'>${string(".linkstripped")}</div>

</div>

</form>
</div></div>`;
    return html;
}

// LJ::Talk::screening_level
async function screeningLevel(pc: PageContext, entry: Entry): Promise<string> {
    const value = entry.props.opt_screening || "";
    if (value === "N") return "";
    if (value) return value;
    await pc.journal.loadProps(pc.db, ["opt_whoscreened"]);
    const prop = pc.journal.props.opt_whoscreened ?? "";
    return prop === "N" ? "" : prop;
}

// LJ::get_secret, as the newest secret that exists: this server cannot make one.
export async function currentSecret(db: Databases): Promise<{ stime: number; secret: string }> {
    const [row] = await db.global("SELECT stime, secret FROM secrets WHERE stime <= UNIX_TIMESTAMP() ORDER BY stime DESC LIMIT 1");
    return { stime: int(row?.stime), secret: text(row?.secret) };
}

// DW::Auth::Challenge::generate
export function challenge(secret: { stime: number; secret: string }, now: number, goodfor: number, attr: string): string {
    const bare = `c0:${secret.stime}:${now - secret.stime}:${goodfor}:${attr}`;
    return `${bare}:${createHash("md5").update(bare + secret.secret).digest("hex")}`;
}

// LJ::rand_chars
export function randChars(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from({ length }, () => chars[randomInt(chars.length)]).join("");
}
