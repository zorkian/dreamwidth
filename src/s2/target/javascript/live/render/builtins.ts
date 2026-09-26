// builtins.ts
//
// Application builtin ports for the bounded local S2 renderer.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/S2.pm host builtins; source code adapted through tools/page-execute.ts.
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


import { BuiltinFunction, Context } from "../../runtime/s2runtime";

type Data = Record<string, any>;

function record(value: unknown, label: string): Data {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid ${label}`);
    }
    return value as Data;
}

export function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function formatPlainSubject(rawEntry: unknown, rawOptions: unknown,
    props: Data = {}, view = "recent"): string {
    const item = record(rawEntry, "entry subject");
    const options = record(rawOptions, "subject options");
    const format = options.format ?? "";
    if (!["", "text"].includes(String(format)) ||
        (options.class !== undefined && typeof options.class !== "string") ||
        (options.style !== undefined && typeof options.style !== "string") ||
        typeof item.subject !== "string" || typeof item._subject_recent !== "string" ||
        typeof item._subject_all !== "string") throw new Error("Unsupported formatted subject domain");
    let subject = item.subject;
    let recent = item._subject_recent;
    let title = item._subject_all;
    let className = String(options.class ?? "");
    if (subject === "") {
        const normal = String(props._text_nosubject ?? "");
        const show=item['.type']==='Comment'?(props._all_commentsubjects||!item.full):
            (props._all_entrysubjects||view==='month');
        subject = normal && show ? normal : "";
        if (!subject) {subject = String(props._text_nosubject_screenreader ?? ""); className += " invisible";}
        recent = subject; title = subject;
    }
    const cssClass = className ? ` class="${escapeHtml(className)}" ` : "";
    const style = options.style ? ` style="${escapeHtml(options.style)}" ` : "";
    if (format === "text" || subject.includes("href") && (item.full || view === "entry" || view === "reply")) {
        return `<span ${cssClass}${style}>${subject}</span>`;
    }
    if (typeof item.permalink_url !== "string" ||
        !/^https?:\/\/[^/\s"<>]+\/\S*$/.test(item.permalink_url)) throw new Error("Unsupported entry permalink");
    // Source helper preserves entity spelling; encode literal delimiters only,
    // without decoding/re-encoding ampersands at this final attribute boundary.
    const attribute = title.replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<a title="${attribute}" href="${item.permalink_url}"${cssClass}${style}>${recent}</a>`;
}

export function callbacks(page: Data, host: Data): Record<string, BuiltinFunction> {
    const alternates = new Map<string, boolean>();
    let quickreplyPrinted = false;
    const anonymous = () => false;
    const escape = escapeHtml;
    const pad = (number: unknown) => String(number ?? 0).padStart(2, "0");
    function datePart(ctx: Context, item: Data, token: string): string {
        const year = Number(item.year ?? 0);
        const month = Number(item.month ?? 0);
        const day = Number(item.day ?? 0);
        const hour = Number(item.hour ?? 0);
        switch (token) {
            case "m": return String(month);
            case "mm": return pad(month);
            case "d": return String(day);
            case "dd": return pad(day);
            case "yy": return pad(year % 100);
            case "yyyy": return String(year);
            case "mon": return String((ctx.prop._lang_monthname_short as unknown[])[month]);
            case "month": return String((ctx.prop._lang_monthname_long as unknown[])[month]);
            case "dayord": return String(ctx.getFunction("lang_ordinal(int)")(ctx, day));
            case "H": return String(hour);
            case "HH": return pad(hour);
            case "h": return String(hour % 12 || 12);
            case "hh": return pad(hour % 12 || 12);
            case "min": return pad(item.min);
            case "sec": return pad(item.sec);
            case "a": return hour < 12 ? "a" : "p";
            case "A": return hour < 12 ? "A" : "P";
            default: throw new Error(`Unknown stock date token ${token}`);
        }
    }
    function formatDate(ctx: Context, value: unknown, format: unknown, kind: string, links = false): string {
        const item = record(value, "S2 date object");
        const requested = String(format || (kind === "month" ? "long" : "short"));
        const configured = ctx.prop[`_lang_fmt_${kind}_${requested}`];
        const pattern = typeof configured === "string" ? configured :
            requested === "iso" ? "%%yyyy%%-%%mm%%-%%dd%%" : requested;
        return pattern.split("%%").map((part, index) => {
            if (index % 2 === 0) return escape(part);
            const rendered = datePart(ctx, item, part);
            if (!links) return rendered;
            const year = Number(item.year ?? 0);
            const month = pad(item.month);
            const day = pad(item.day);
            const path = /^(d|dd|dayord)$/.test(part) ? `/${year}/${month}/${day}/` :
                /^(m|mm|mon|month)$/.test(part) ? `/${year}/${month}/` :
                /^(yy|yyyy)$/.test(part) ? `/${year}/` : "";
            return path ? `<a href="${path}">${rendered}</a>` : rendered;
        }).join("");
    }
    function s2Object(type: string, fields: Data): Data {
        const result: Data = { ".type": type, _type: type };
        for (const [name, value] of Object.entries(fields)) {
            result[name] = value;
            result[`_${name}`] = value;
        }
        return result;
    }
    function printEntryReplyLink(ctx: Context, rawEntry: unknown, rawOptions: unknown): void {
        const item = record(rawEntry, "reply entry");
        const options = record(rawOptions, "reply link options");
        if (["img_url", "basesubject", "reply_url", "img_width", "img_height",
            "img_align", "img_border", "alt", "title"].some(key => options[key])) {
            throw new Error("Unsupported reply link option");
        }
        const comments = record(item.comments, "entry comment info");
        const target = String(options.target ?? "");
        if (!/^[\w-]+$/.test(target)) return;
        const linktext = escape(options.linktext ?? "");
        const css = typeof options.class === "string" && /^[\w\s-]+$/.test(options.class)
            ? `class="${options.class}"` : "";
        const quickreply = host.has_quickreply && host.s2quickreply && !host.comments_need_access;
        const onclick = quickreply
            ? `onclick='return function(that) {return quickreply("${target}", 0, "",that)}(this)'`
            : "";
        const postUrl = comments.post_url;
        if (typeof postUrl !== "string" || !/^https?:\/\/[^/\s]+\/\S*$/.test(postUrl) ||
            /[&"'<>]/.test(postUrl)) {
            throw new Error("Unsupported noncanonical reply URL");
        }
        ctx.print(`<a ${onclick} href='${escape(postUrl)}' ${css}>${linktext}</a>`);
    }
    function printEntryReplyContainer(ctx: Context, rawEntry: unknown,
        rawOptions: unknown): void {
        if (!host.has_quickreply) return;
        const item = record(rawEntry, "reply container entry");
        const options = record(rawOptions??{}, "reply container options");
        const target = String(options.target || item.talkid || "");
        if (!/^[\w-]+$/.test(target)) return;
        const css = typeof options.class === "string" && /^[\w\s]+$/.test(options.class)
            ? `class="${options.class}"` : "";
        ctx.print(`<div ${css} id="ljqrt${target}" data-quickreply-container="${target}" ` +
            'style="display: none;"></div>');
        if (!quickreplyPrinted) {
            if (typeof host.quickreply_div !== "string") {
                throw new Error("Missing app-owned quickreply fragment");
            }
            ctx.print(host.quickreply_div);
            quickreplyPrinted = true;
        }
    }
    function commentLink(ctx:Context,raw:unknown,key:unknown):Data {
        const comment=record(raw,'comment link');
        if(!Number.isSafeInteger(comment.talkid)||!Array.isArray(comment.replies))throw new Error('Invalid comment link');
        let show=false;
        if(key==='expand_comments')show=!!comment._expander_allowed&&
            ((!comment.full&&!comment.deleted)||comment.replies.some((child:Data)=>!child.full&&!child.deleted));
        else if(key==='hide_comments'||key==='unhide_comments')show=comment.replies.length>0;
        else if(!['delete_comment','screen_comment','unscreen_comment','unscreen_to_reply','freeze_thread','unfreeze_thread',
            'watch_thread','unwatch_thread','watching_parent','edit_comment'].includes(String(key)))throw new Error('Unknown comment link');
        return show?s2Object('Link',{url:'#',caption:ctx.prop[key==='expand_comments'?'_text_comment_expand':
            key==='hide_comments'?'_text_comment_hide':'_text_comment_unhide'],icon:{'.type':'Image','.isnull':true},extra:{}}):
            {'.type':'Link','.isnull':true,_url:''};
    }
    function commentReadLink(ctx:Context,raw:unknown,rawOptions:unknown,kind:'expand'|'hide'|'unhide'):string {
        const comment=record(raw,'comment control'),options=rawOptions?record(rawOptions,'comment control options'):{};
        const caption=escape(options.text||ctx.prop['_text_comment_'+kind]);
        const attrs=(options.title?` title='${escape(options.title)}'`:'')+(options.class?` class='${escape(options.class)}'`:'');
        let text=caption;
        if(options.img_url) {
            const url=String(options.img_url);
            if(!/^https?:\/\/[^\s'"<>]+$/.test(url)&&!/^\/(?!\/)[^\s'"<>]*$/.test(url))throw new Error('Unsupported comment control image');
            const sizes=['width','height','border'].map(key=>options['img_'+key]!==undefined&&/^\d+$/.test(String(options['img_'+key]))?
                ` ${key}="${options['img_'+key]}"`:'').join('');
            const align=options.img_align&&/^\w+$/.test(String(options.img_align))?` align="${escape(options.img_align)}"`:'';
            text=`<img src="${escape(url)}"${sizes}${align} title="${escape(options.img_title||caption)}" alt="${escape(options.img_alt||caption)}" />`+
                (options.text?escape(options.text):'');
        }
        const id=comment.talkid;
        if(!Number.isSafeInteger(id)||id<1||id>1099511627775)throw new Error('Invalid comment control id');
        const href=kind==='hide'?`#cmt${id}`:comment.expand_url;
        const action=kind==='expand'?`Expander.make(this,'${comment.js_expand_url}','${id}'); return false;`:
            `Expander.${kind==='hide'?'hideComments':'unhideComments'}(this, '${id}'); return false;`;
        return `<a href='${escape(href)}'${attrs} onClick="${escape(action)}">${text}</a>`;
    }
    return {
        _get_page: () => page,
        _get_image: (_ctx, name) => {
            if (name !== "admin-post") throw new Error(`Unknown stock image ${String(name)}`);
            const image = record(host.admin_post_image, "render stock image");
            if (image[".type"] !== "Image") throw new Error("Wrong stock image type");
            return image;
        },
        _Page__print_control_strip: ctx => {
            if (typeof host.control_strip_html !== "string") {
                throw new Error("Missing control-strip host fragment");
            }
            ctx.print(host.control_strip_html);
        },
        _Page__print_script_tags: ctx => {
            if (typeof host.script_tags_html !== "string") {
                throw new Error("Missing app-owned script resource fragment");
            }
            ctx.print(host.script_tags_html);
        },
        _EntryLite__formatted_subject: (_ctx, entry, rawOptions) =>
            formatPlainSubject(entry, rawOptions, _ctx.prop, String(page.view)),
        _Entry__get_plain_subject: (_ctx, rawEntry) => {
            const entry = record(rawEntry, "plain entry subject");
            if (typeof entry._subject_all !== "string") {
                throw new Error("Unsupported plain entry subject");
            }
            return entry._subject_all;
        },
        _DateTime__date_format: (ctx, date, format, links) =>
            formatDate(ctx, date, format, "date", Boolean(links)),
        _DateTime__time_format: (ctx, date, format) => formatDate(ctx, date, format, "time"),
        _YearMonth__month_format: (ctx, month, format, links) =>
            formatDate(ctx, month, format, "month", Boolean(links)),
        _Page__get_latest_month: (_ctx, currentPage) => {
            if (currentPage !== page) throw new Error("Unknown calendar page");
            return host.calendar_month;
        },
        _Page__visible_tag_list: (_ctx, currentPage, limit) => {
            if(currentPage!==page||!Array.isArray(host.visible_tags))throw new Error("Unsupported tag page");
            const count=limit===undefined||limit===""?0:Number(limit);
            if(!Number.isSafeInteger(count)||count<0)throw new Error("Unsupported tag limit");
            const compare=(a:unknown,b:unknown):number=>{
                const one=record(a,"tag"),two=record(b,"tag");
                return Buffer.compare(Buffer.from(String(one.name)),Buffer.from(String(two.name)))||Number(one._id)-Number(two._id);
            };
            let tags=[...host.visible_tags];
            // Native popularity cutoff ties depend on hash iteration. A byte
            // name/kwid tie break makes this boundary deterministic explicitly.
            if(count)tags=tags.sort((a,b)=>Number(record(b,"tag").use_count)-Number(record(a,"tag").use_count)||compare(a,b)).slice(0,count);
            return tags.sort(compare);
        },
        _UserLite__equals: (_ctx, one, two) => {
            const left = record(one, "first S2 user");
            const right = record(two, "second S2 user");
            if (!Number.isSafeInteger(left.host_userid) || !Number.isSafeInteger(right.host_userid)) {
                throw new Error("Missing user identity in render S2 data");
            }
            return left.host_userid === right.host_userid;
        },
        _UserLite__get_link: (ctx, user, key) => {
            const person = record(user, "S2 link user");
            if(person.user!==host.owner_user)return {".type":"Link",".isnull":true,_url:""};
            const links = record(host.user_links, "render app user links");
            const raw = links[String(key)];
            if (raw === undefined) return { ".type": "Link", ".isnull": true, _url: "" };
            const link = record(raw, `user link ${String(key)}`);
            if (typeof link.image !== "string" || !Number.isSafeInteger(link.width) ||
                !Number.isSafeInteger(link.height)) {
                throw new Error("Unsupported user link image dimensions");
            }
            const caption = ctx.prop._userlite_interaction_links === "text" ? link.text : link.title;
            const icon = s2Object("Image", {
                url: link.image, width: link.width,
                height: link.height, alttext: "", extra: {},
            });
            return s2Object("Link", {
                url: link.url ?? "", caption: caption ?? "", icon, extra: {},
            });
        },
        _UserLite__ljuser: (_ctx, user, color) => {
            const person = record(user, "S2 ljuser");
            if (!host.user_badges?.[String(person.host_userid)] ||
                (color && typeof color === "object" && !(color as Data)[".isnull"])) {
                throw new Error("Unsupported S2 ljuser variant");
            }
            if (typeof host.ljuser_html !== "string") throw new Error("Missing app user tag");
            return host.user_badges[String(person.host_userid)];
        },
        _EntryPage__print_multiform_start:()=>{if(page.multiform_on)throw new Error('Authenticated multiform unsupported');},
        _EntryPage__print_multiform_end:()=>{if(page.multiform_on)throw new Error('Authenticated multiform unsupported');},
        _EntryPage__print_multiform_actionline:()=>{if(page.multiform_on)throw new Error('Authenticated multiform unsupported');},
        _Comment__get_link:commentLink,
        _Comment__formatted_subject:(ctx,item,options)=>formatPlainSubject(item,options,ctx.prop,'entry'),
        _Comment__get_plain_subject:(_ctx,item)=>record(item,'comment subject')._subject_all,
        _Comment__print_multiform_check:()=>{},
        _Comment__print_expand_link:(ctx,item,options)=>ctx.print(commentReadLink(ctx,item,options,'expand')),
        _Comment__expand_link:(ctx,item,options)=>commentReadLink(ctx,item,options,'expand'),
        _Comment__print_hide_link:(ctx,item,options)=>ctx.print(commentReadLink(ctx,item,options,'hide')),
        _Comment__print_unhide_link:(ctx,item,options)=>ctx.print(commentReadLink(ctx,item,options,'unhide')),
        _Comment__print_reply_container:printEntryReplyContainer,
        _Comment__print_reply_link:(ctx,item,options)=>{
            const comment=record(item,'comment reply'),opts=record(options??{},'comment reply options');
            const target=String(opts.target||comment.talkid);
            if(!/^\d+$/.test(target))throw new Error('Invalid comment reply target');
            ctx.print(`<a onclick='return function(that) {return quickreply("${target}", 0, "",that)}(this)' href='${escape(comment.reply_url)}' `+
                (opts.class?`class="${escape(opts.class)}"`:'')+`>${escape(opts.linktext??'')}</a>`);
        },
        _ItemRange__url_of:(_ctx,range,n)=>{
            const value=Number(n),item=record(range,'comment range');
            if(!Number.isSafeInteger(value)||!item._page_base)throw new Error('Unsupported comment page');
            return `${item._page_base}?page=${value}`;
        },
        _Entry__get_link: (ctx, rawEntry, key) => {
            if (!["edit_entry", "edit_tags", "mem_add", "tell_friend", "nav_prev", "nav_next",
                "watch_comments", "unwatch_comments"].includes(String(key))) {
                throw new Error(`Unknown recent-entry link ${String(key)}`);
            }
            const entry = record(rawEntry, "entry link source");
            const journal = record(entry.journal, "entry journal");
            const itemid = Number(entry.itemid);
            if (!Number.isSafeInteger(itemid) || journal.user !== host.owner_user) {
                throw new Error("Invalid render entry link identity");
            }
            if (key === "nav_prev" || key === "nav_next") {
                if (page._type !== "EntryPage" || page.entry !== entry ||
                    typeof host.app_origin !== "string") {
                    throw new Error("Unsupported entry navigation identity");
                }
                const dir = key === "nav_prev" ? "prev" : "next";
                return s2Object("Link", {
                    url: `${host.app_origin}/go?dir=${dir}&itemid=${itemid}&journal=${journal.user}`,
                    caption: ctx.prop[`_text_entry_${dir}`],
                    icon: record(host[`${dir}_entry_image`], "app navigation icon"), extra: {},
                });
            }
            if (key === "mem_add" && host.memories_enabled) {
                return s2Object("Link", {
                    url: `${host.siteroot}/tools/memadd?journal=${journal.user}&amp;itemid=${itemid}`,
                    caption: ctx.prop._text_mem_add,
                    icon: record(host.memadd_image, "app memory icon"), extra: {},
                });
            }
            if (key === "tell_friend" && host.tellafriend_enabled &&
                record(host.entry_can_tell_friend, "tell-friend decisions")[String(itemid)]) {
                return s2Object("Link", {
                    url: `${host.siteroot}/tools/tellafriend?journal=${journal.user}&amp;itemid=${itemid}`,
                    caption: ctx.prop._text_tell_friend,
                    icon: record(host.tellfriend_image, "app share icon"), extra: {},
                });
            }
            return { ".type": "Link", ".isnull": true, _url: "" };
        },
        _Entry__print_reply_link: printEntryReplyLink,
        _Entry__print_reply_container: printEntryReplyContainer,
        _EntryPage__print_reply_link: (ctx, rawPage, rawOptions) => {
            if (rawPage !== page) throw new Error("Unknown reply page identity");
            return printEntryReplyLink(ctx, record(page.entry, "reply page entry"), rawOptions);
        },
        _EntryPage__print_reply_container: (ctx, rawPage, rawOptions) => {
            if (rawPage !== page) throw new Error("Unknown reply page identity");
            return printEntryReplyContainer(ctx, record(page.entry, "reply page entry"), rawOptions);
        },
        _viewer_logged_in: anonymous, _viewer_is_owner: anonymous,
        _viewer_has_access: anonymous, _viewer_is_subscribed: anonymous,
        _viewer_is_member: anonymous, _viewer_is_admin: anonymous,
        _viewer_is_moderator: anonymous, _viewer_can_search: anonymous,
        // S2.pm viewer_can_manage_tags -> User/Login.pm get_authas_user:
        // no remote returns undef before any account lookup.
        _viewer_can_manage_tags: anonymous,
        _viewer_sees_control_strip: () => host.viewer_sees_control_strip,
        _alternate: (_ctx, one, two) => {
            const key = `${one}\0${two}`;
            const next = !alternates.get(key);
            alternates.set(key, next);
            return next ? one : two;
        },
        _clean_css_classname: (_ctx, name) => String(name).includes("eval")
            ? `${name} ${String(name).replaceAll("eval", "ev-l")}` : name,
        _htmlattr: (_ctx, name, value) => {
            const text = String(value ?? "");
            if (text === "") return "";
            const attribute = String(name).toLowerCase();
            if (/[^a-z]/.test(attribute)) return "";
            return ` ${attribute}="${escape(text)}"`;
        },
        _ehtml: (_ctx, text) => escape(text),
        _striphtml: (_ctx, text) => String(text).replace(/<.*?>/g, ""),
        _string__contains: (_ctx, text, part) => String(text).includes(String(part)),
        _weekdays: ctx => ctx.prop._reg_firstdayofweek === "monday"
            ? [2, 3, 4, 5, 6, 7, 1] : [1, 2, 3, 4, 5, 6, 7],
        _get_plural_phrase: (ctx, count, property) => {
            const form = Number(ctx.getFunction("lang_map_plural(int)")(ctx, count));
            const raw = ctx.prop[`_${property}`];
            if (typeof raw !== "string") throw new Error(`Missing plural property ${property}`);
            const choices = raw.split(/\s*\/\/\s*/);
            const phrase = choices[form] ?? choices[choices.length - 1];
            return escape(phrase!.replace("#", String(count ?? 0)));
        },
    };
}
