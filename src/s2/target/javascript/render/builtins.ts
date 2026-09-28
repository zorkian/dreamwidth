// builtins.ts
//
// Host functions that S2 layers call, ported from S2::Builtin::LJ in
// LJ/S2.pm. Pages are rendered for an anonymous visitor, so the viewer_*
// checks are all false and links that need a logged-in viewer are null.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { BuiltinFunction, Context } from "../runtime/s2runtime";
import { cleanCss } from "./css-cleaner";
import { type S2Object, ImageStd, Link, ehtml, eurl, nullObject, s2 } from "./objects";
import type { RenderState } from "./state";

type Builtin = (ctx: Context, ...args: any[]) => unknown;

const NULL_LINK = () => nullObject("Link");
const pad2 = (n: unknown) => String(Math.trunc(Number(n) || 0)).padStart(2, "0");

// LJ::ejs
export function ejs(value: unknown): string {
    return String(value ?? "").replace(/(?=["'\\])/g, "\\").replaceAll("&quot;", "\\&quot;")
        .replace(/\r?\n/g, "\\n").replaceAll("\r", "").replace(/[\u2028\u2029]/g, "");
}

// LJ::CleanHTML::canonical_url
export function canonicalUrl(url: unknown): string {
    let text = String(url ?? "").trim();
    if (!text) return "";
    const scheme = /^(https?|ftp|webcal):/.exec(text)?.[1] ?? "http";
    text = text.replace(/^.*?:\/*/, "");
    return text ? `${scheme}://${text}` : "";
}

// Perl truthiness.
const truthy = (value: unknown) => !(value === undefined || value === null || value === "" || value === "0" ||
    value === 0 || value === false);

export function createBuiltins(state: RenderState): Record<string, BuiltinFunction> {
    const props = (ctx: Context) => ctx.prop as Record<string, any>;
    const pout = (ctx: Context, text: string) => ctx.print(text);
    const image = (ctx: Context, name: string) => ImageStd(state.config, props(ctx), name) ?? nullObject("Image");
    const alternates = new Map<string, boolean>();
    let cssDepth = 0;
    let quickreplyPrinted = false;

    // Date formatting: LJ::S2 compiles %%code%% templates.
    const dayOfWeek = (time: S2Object) => {
        if (time._dayofweek !== undefined) return Number(time._dayofweek);
        const day = new globalThis.Date(Date.UTC(time._year, time._month - 1, time._day)).getUTCDay() + 1;
        time._dayofweek = day;
        return day;
    };
    const dateVar = (ctx: Context, time: S2Object, code: string): string | undefined => {
        const p = props(ctx);
        switch (code) {
            case "m": return String(time._month);
            case "mm": return pad2(time._month);
            case "d": return String(time._day);
            case "dd": return pad2(time._day);
            case "yy": return pad2(Number(time._year) % 100);
            case "yyyy": return String(time._year);
            case "mon": return String(p._lang_monthname_short?.[time._month] ?? "");
            case "month": return String(p._lang_monthname_long?.[time._month] ?? "");
            case "da": return String(p._lang_dayname_short?.[dayOfWeek(time)] ?? "");
            case "day": return String(p._lang_dayname_long?.[dayOfWeek(time)] ?? "");
            case "dayord": return String(ctx.getFunction("lang_ordinal(int)")(ctx, time._day));
            case "H": return String(time._hour);
            case "HH": return pad2(time._hour);
            case "h": return String(Number(time._hour) % 12 || 12);
            case "hh": return pad2(Number(time._hour) % 12 || 12);
            case "min": return pad2(time._min);
            case "sec": return pad2(time._sec);
            case "a": return Number(time._hour) < 12 ? "a" : "p";
            case "A": return Number(time._hour) < 12 ? "A" : "P";
            default: return undefined;
        }
    };
    const datePath = (time: S2Object, code: string) =>
        /^(d|dd|dayord)$/.test(code) ? `/${time._year}/${pad2(time._month)}/${pad2(time._day)}/`
            : /^(m|mm|mon|month)$/.test(code) ? `/${time._year}/${pad2(time._month)}/`
                : /^(yy|yyyy)$/.test(code) ? `/${time._year}/` : undefined;
    const formatTime = (ctx: Context, time: S2Object, kind: string, format: string, asLink: boolean) => {
        const configured = props(ctx)[`_lang_fmt_${kind}_${format}`];
        const template = configured !== undefined ? String(configured)
            : kind === "date" && format === "iso" ? "%%yyyy%%-%%mm%%-%%dd%%" : format;
        return template.split("%%").map((part, i) => {
            if (i % 2 === 0) return ehtml(part);
            const value = dateVar(ctx, time, part) ?? "";
            const path = asLink ? datePath(time, part) : undefined;
            return path ? `<a href="${path}">${value}</a>` : value;
        }).join("");
    };

    // Color helpers, from S2::Builtin::LJ and S2::Color.
    const colorString = (c: S2Object) => {
        c._as_string = "#" + [c._r, c._g, c._b].map(v => Number(v).toString(16).padStart(2, "0")).join("");
    };
    const color = (r: number, g: number, b: number): S2Object => {
        const c = s2("Color", { r, g, b });
        colorString(c);
        return c;
    };
    const updateHsl = (c: S2Object) => {
        if (c.$hslset) return;
        c.$hslset = true;
        const [h, s, l] = rgbToHsl(c._r, c._g, c._b);
        [c.$h, c.$s, c.$l] = [h, s, l].map(v => Math.trunc(v * 255 + 0.5));
    };
    const updateRgb = (c: S2Object) => {
        [c._r, c._g, c._b] = hslToRgb(c.$h / 255, c.$s / 255, c.$l / 255);
        colorString(c);
    };
    const channel = (key: "_r" | "_g" | "_b") => (_ctx: Context, c: S2Object, value?: number) => {
        if (value !== undefined) {
            c[key] = mod256(value);
            delete c.$hslset;
            colorString(c);
        }
        return c[key];
    };
    const hslChannel = (key: "$h" | "$s" | "$l") => (_ctx: Context, c: S2Object, value?: number) => {
        updateHsl(c);
        if (value !== undefined) {
            c[key] = mod256(value);
            updateRgb(c);
        }
        return c[key];
    };
    const shade = (sign: 1 | -1) => (_ctx: Context, c: S2Object, amount?: number) => {
        updateHsl(c);
        const lightness = c.$l + sign * (amount ?? 30);
        const next = s2("Color", { $hslset: true, $h: c.$h, $s: c.$s, $l: Math.max(0, Math.min(255, lightness)) });
        updateRgb(next);
        return next;
    };

    // EntryLite::formatted_subject
    const formattedSubject = (ctx: Context, item: S2Object, opts: Record<string, any> = {}) => {
        const p = props(ctx);
        let subject: string = item._subject ?? "";
        let noa: string = item.$subject_noa ?? subject;
        let all: string = item.$subject_all ?? subject;
        const format = opts.format ?? "";
        let className: string = opts.class ?? "";
        const setSubject = (showAll: string, always: boolean) => {
            if (subject !== "") return;
            if (p._text_nosubject !== "" && (truthy(p[`_${showAll}`]) || always)) subject = p._text_nosubject;
            if (subject === "") {
                subject = p._text_nosubject_screenreader ?? "";
                className += " invisible";
            }
            noa = all = subject;
        };
        if (item[".type"] === "Entry" || item[".type"] === "StickyEntry") {
            setSubject("all_entrysubjects", state.page()._view === "month");
        } else if (item[".type"] === "Comment") {
            setSubject("all_commentsubjects", !truthy(item._full));
        }
        const cls = className ? ` class="${ehtml(className)}" ` : "";
        const style = opts.style ? ` style="${ehtml(opts.style)}" ` : "";
        const view = state.page()._view;
        if (format === "text" || (/href/.test(subject) && (truthy(item._full) || view === "reply" || view === "entry"))) {
            return `<span ${cls}${style}>${subject}</span>`;
        }
        return `<a title="${all}" href="${item._permalink_url}"${cls}${style}>${noa}</a>`;
    };

    // _print_quickreply_link
    const printReplyLink = (ctx: Context, item: S2Object, opts: Record<string, any> = {}) => {
        let replyUrl = opts.reply_url || item._reply_url || item._entry?._comments?._post_url || item._comments?._post_url;
        let linktext = ehtml(opts.linktext) || "";
        const target = String(opts.target ?? "");
        if (!/^[\w-]+$/.test(target)) return;
        let optClass: string | undefined = opts.class || "";
        if (!/^[\w\s-]+$/.test(optClass!)) optClass = undefined;
        const img = canonicalUrl(opts.img_url);
        replyUrl = canonicalUrl(replyUrl);
        if (img) {
            const width = Math.trunc(Number(opts.img_width) || 0), height = Math.trunc(Number(opts.img_height) || 0);
            const border = Math.trunc(Number(opts.img_border) || 0);
            const align = /^\w+$/.test(opts.img_align ?? "") ? `align="${opts.img_align}"` : "";
            const alt = ehtml(opts.alt), title = ehtml(opts.title);
            linktext = `<img src="${img}" ${width ? `width=${width}` : ""} ${height ? `height=${height}` : ""} ${align} ` +
                `${title ? `title="${title}"` : ""} ${alt ? `alt="${alt}"` : ""} border=${border} />${linktext}`;
        }
        const page = state.page();
        let onclick = "";
        if (hasQuickreply(page)) {
            const pid = /^\d+$/.test(target) && page[".type"] === "EntryPage" ? Math.trunc(Number(target) / 256) : 0;
            let base = String(opts.basesubject || "").replace(/^(Re:\s*)*/i, "");
            if (base) base = `Re: ${base}`;
            onclick = `onclick='return function(that) {return quickreply("${target}", ${pid}, "${ejs(base)}",that)}(this)'`;
        }
        pout(ctx, `<a ${onclick} href='${ehtml(replyUrl)}' ${optClass ? `class="${optClass}"` : ""}>${linktext}</a>`);
    };

    // _print_reply_container
    const printReplyContainer = (ctx: Context, item: S2Object, opts: Record<string, any> = {}) => {
        const page = state.page();
        if (!hasQuickreply(page)) return;
        let target: string | undefined = opts.target || "";
        if (!/^[\w-]+$/.test(target!)) target = undefined;
        const className = /^[\w\s]+$/.test(opts.class ?? "") ? `class="${opts.class}"` : "";
        target ||= item._talkid ? String(item._talkid) : undefined;
        if (!target) return;
        pout(ctx, `<div ${className} id="ljqrt${target}" data-quickreply-container="${target}" style="display: none;"></div>`);
        if (!quickreplyPrinted) {
            quickreplyPrinted = true;
            pout(ctx, state.chrome.quickreplyDiv(page));
        }
    };

    // Comment expand/hide/unhide links share their image handling.
    const commentLinkText = (ctx: Context, item: S2Object, opts: Record<string, any>, propText: string) => {
        let text = ehtml(opts.text).replace(/&amp;nbsp;/gi, "&nbsp;");
        const img = canonicalUrl(opts.img_url);
        if (img) {
            const attr = (key: string, name: string) =>
                opts[key] !== undefined && /^\d+$/.test(String(opts[key])) ? ` ${name}="${opts[key]}"` : "";
            const align = /^\w+$/.test(ehtml(opts.img_align)) ? ` align="${ehtml(opts.img_align)}"` : "";
            const alt = ehtml(opts.img_alt) || propText, title = ehtml(opts.img_title) || propText;
            text = `<img src="${img}"${attr("img_width", "width")}${attr("img_height", "height")}` +
                `${attr("img_border", "border")}${align}${title ? ` title="${title}"` : ""}${alt ? ` alt="${alt}"` : ""} />${text}`;
        } else if (!text) {
            text = propText;
        }
        const title = opts.title ? ` title='${ehtml(opts.title)}'` : "";
        const cls = opts.class ? ` class='${ehtml(opts.class)}'` : "";
        return { text, attrs: title + cls };
    };
    const pluralPhrase = (ctx: Context, n: unknown, prop: string) => {
        const count = n ?? 0;
        const form = Number(ctx.getFunction("lang_map_plural(int)")(ctx, count));
        const choices = String(props(ctx)[`_${prop}`] ?? "").split(/\s*\/\/\s*/);
        const text = choices[form] ?? choices[choices.length - 1] ?? "";
        return ehtml(text.replace("#", String(count)));
    };
    const expandLink = (ctx: Context, item: S2Object, opts: Record<string, any> = {}) => {
        const { text: base, attrs } = commentLinkText(ctx, item, opts, ehtml(props(ctx)._text_comment_expand));
        let text = base;
        let onclick: string;
        if (truthy(item.$hide_children)) {
            text = ehtml(pluralPhrase(ctx, item._showable_children, "text_comment_unhide"));
            onclick = ` onClick="Expander.make(this,'${item.$js_expand_url}','${item._talkid}', true); return false;"`;
        } else {
            onclick = ` onClick="Expander.make(this,'${item.$js_expand_url}','${item._talkid}'); return false;"`;
        }
        return `<a href='${item._expand_url}'${attrs}${onclick}>${text}</a>`;
    };

    // _Entry__get_link: only links an anonymous visitor may see.
    const entryLink = (ctx: Context, item: S2Object, key: string) => {
        const journal = item._journal?._user;
        const p = props(ctx);
        const go = (dir: string) => `${state.siteRoot()}/go?journal=${journal}&itemid=${item._itemid}&dir=${dir}`;
        switch (key) {
            case "mem_add":
                return Link(`${state.siteRoot()}/tools/memadd?journal=${journal}&amp;itemid=${item._itemid}`,
                    p._text_mem_add, image(ctx, "memadd"));
            case "tell_friend":
                return Link(`${state.siteRoot()}/tools/tellafriend?journal=${journal}&amp;itemid=${item._itemid}`,
                    p._text_tell_friend, image(ctx, "tellfriend"));
            case "nav_prev": return Link(go("prev"), p._text_entry_prev, image(ctx, "prev_entry"));
            case "nav_next": return Link(go("next"), p._text_entry_next, image(ctx, "next_entry"));
            default: return NULL_LINK();
        }
    };

    // _Comment__get_link
    const commentLink = (ctx: Context, item: S2Object, key: string) => {
        const p = props(ctx);
        const replies: S2Object[] = item._replies ?? [];
        switch (key) {
            case "unscreen_to_reply":
                return Link(`${state.siteRoot()}/talkscreen?mode=unscreen&amp;journal=${state.journal.user}&amp;talkid=${item._talkid}`,
                    p._text_multiform_opt_unscreen_to_reply, image(ctx, "btn_unscr"));
            case "expand_comments": {
                if (!state.showThreadExpander) return NULL_LINK();
                const show = (!truthy(item._full) && !truthy(item._deleted)) ||
                    replies.some(child => !truthy(child._full) && !truthy(child._deleted));
                return show ? Link("#", p._text_comment_expand) : NULL_LINK();
            }
            case "hide_comments": return replies.length ? Link("#", p._text_comment_hide) : NULL_LINK();
            case "unhide_comments": return replies.length ? Link("#", p._text_comment_unhide) : NULL_LINK();
            default: return NULL_LINK();
        }
    };

    const getLink = (ctx: Context, item: S2Object, key: string) =>
        item[".type"] === "Entry" || item[".type"] === "StickyEntry" ? entryLink(ctx, item, key)
            : item[".type"] === "Comment" ? commentLink(ctx, item, key) : NULL_LINK();

    const cssLengthValue = (value: string) => {
        const text = value.replace(/^\s+/, "").replace(/\s+$/, "");
        if (["larger", "smaller", "xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "auto",
            "inherit"].includes(text)) return text;
        const match = /^[-+]?(\d*\.)?\d+([a-z]+|%)$/.exec(text);
        if (match && ["em", "ex", "px", "in", "cm", "mm", "pt", "pc", "%"].includes(match[2]!)) return text;
        return /^(0*\.)?0+$/.test(text) ? "0" : "";
    };
    const cssKeyword = (value: string, allowed?: string[] | Set<string>) => {
        const text = value.replace(/^\s+/, "").replace(/\s+$/, "");
        if (/[^a-z-]/i.test(text)) return "";
        if (allowed && !(Array.isArray(allowed) ? allowed.includes(text) : allowed.has(text))) return "";
        return text.toLowerCase();
    };
    const cssString = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    const palimg = (filename: string) => /^\w[\w/-]*\.(gif|png)$/.test(filename) ? `${state.config.palImgRoot}/${filename}` : undefined;
    const hex2 = (n: unknown) => Number(n).toString(16).padStart(2, "0");

    const functions: Record<string, Builtin> = {
        // Output and page
        _start_css: () => {
            if (cssDepth++) return;
            state.output.startCapture();
        },
        _end_css: ctx => {
            if (!cssDepth || --cssDepth !== 0) return;
            const css = state.output.endCapture();
            pout(ctx, `/* Cleaned CSS: */\n${cleanCss(css)}\n`);
        },
        _get_page: () => state.page(),
        _get_image: (ctx, name) => image(ctx, String(name)),
        _set_content_type: () => { throw new Error("set_content_type is not yet implemented"); },
        _Page__print_control_strip: ctx => pout(ctx, state.chrome.controlStrip()),
        _Page__print_script_tags: ctx => pout(ctx, state.chrome.scriptTags()),
        _Page__print_trusted: () => {},
        _Page__print_hbox_top: () => {}, _Page__print_hbox_bottom: () => {}, _Page__print_vbox: () => {},
        _Page__print_ad_box: () => {}, _Page__print_ad: () => {}, _Entry__print_ebox: () => {},
        _Page__visible_tag_list: (_ctx, _page, limit) => state.visibleTags(Number(limit) || 0),
        _Page__get_latest_month: () => state.latestMonth(),
        _Page__print_reply_link: printReplyLink,
        _Page__print_reply_container: printReplyContainer,
        _print_search_form: () => "",

        // Viewer: always an anonymous visitor.
        _viewer_logged_in: () => false, _viewer_is_owner: () => false, _viewer_is_friend: () => false,
        _viewer_has_access: () => false, _viewer_is_subscribed: () => false, _viewer_is_member: () => false,
        _viewer_is_admin: () => false, _viewer_is_moderator: () => false, _viewer_can_manage_tags: () => false,
        _viewer_can_search: () => false, _viewer_sees_control_strip: () => state.showControlStrip,
        _viewer_sees_vbox: () => false, _viewer_sees_hbox_top: () => false, _viewer_sees_hbox_bottom: () => false,
        _viewer_sees_ad_box: () => false, _viewer_sees_ebox: () => false, _viewer_sees_ads: () => false,
        _Entry__viewer_sees_ebox: () => false,
        _control_strip_logged_out_userpic_css: () => state.chrome.controlStripUserpicCss(false),
        _control_strip_logged_out_full_userpic_css: () => state.chrome.controlStripUserpicCss(true),
        _journal_subscription_filters: () => [],
        _style_is_active: () => true,

        // Text helpers
        _alternate: (_ctx, one, two) => {
            const key = `${one}\0${two}`;
            alternates.set(key, !alternates.get(key));
            return alternates.get(key) ? one : two;
        },
        _clean_css_classname: (_ctx, name) => /eval/.test(name) ? `${name} ${String(name).replaceAll("eval", "ev-l")}` : name,
        _striphtml: (_ctx, text) => String(text ?? "").replace(/<.*?>/g, ""),
        _ehtml: (_ctx, text) => ehtml(text),
        _eurl: (_ctx, text) => eurl(text),
        _etags: (_ctx, text) => String(text ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        _clean_url: (_ctx, text) => /^https?:\/\/[^'"\\]*$/.test(String(text ?? "")) ? text : "",
        _get_plural_phrase: (ctx, n, prop) => pluralPhrase(ctx, n, String(prop)),
        _get_url: (_ctx, obj, view) => {
            const name = typeof obj === "object" && obj ? obj._user : obj;
            const base = state.userBase(String(name));
            if (base === undefined) return "";
            const path = view === "userinfo" ? "profile" : view === "recent" ? "" : view;
            return `${base}/${path}`;
        },
        _htmlattr: (_ctx, name, value) => {
            if (value === "" || value === undefined) return "";
            const key = String(name).toLowerCase();
            return /[^a-z]/.test(key) ? "" : ` ${key}="${ehtml(value)}"`;
        },
        _rand: (_ctx, a, b) => {
            const [low, high] = Array.isArray(a) ? [0, a.length - 1] : b === undefined ? [1, Number(a)] : [Number(a), Number(b)];
            return Math.trunc(Math.random() * (high - low + 1)) + low;
        },
        _pageview_unique_string: () => Math.random().toString(36).slice(2),
        _weekdays: ctx => props(ctx)._reg_firstdayofweek === "monday" ? [2, 3, 4, 5, 6, 7, 1] : [1, 2, 3, 4, 5, 6, 7],
        _zeropad: (_ctx, n, digits) => String(Math.trunc(Number(n) || 0)).padStart(Number(digits) || 0, "0"),
        _int__zeropad: (_ctx, n, digits) => String(Math.trunc(Number(n) || 0)).padStart(Number(digits) || 0, "0"),
        _int__compare: (_ctx, a, b) => Math.sign(Number(b) - Number(a)),
        _keys_alpha: (_ctx, hash) => hash && typeof hash === "object" ? Object.keys(hash).sort() : undefined,
        _set_handler: (ctx, hook, statements) => setHandler(ctx, String(hook), statements),
        _journal_current_datetime: () => state.journalCurrentDateTime(),

        // Strings
        _string__index: (_ctx, text, sub, position) => String(text).indexOf(String(sub), Number(position) || 0),
        _string__substr: (_ctx, text, start, length) => {
            const chars = [...String(text)];
            const from = Number(start) < 0 ? Math.max(0, chars.length + Number(start)) : Number(start);
            const to = length === undefined ? chars.length
                : Number(length) < 0 ? chars.length + Number(length) : from + Number(length);
            return chars.slice(from, to).join("");
        },
        _string__length: (_ctx, text) => [...String(text)].length,
        _string__lower: (_ctx, text) => String(text).toLowerCase(),
        _string__upper: (_ctx, text) => String(text).toUpperCase(),
        _string__upperfirst: (_ctx, text) => String(text).charAt(0).toUpperCase() + String(text).slice(1),
        _string__starts_with: (_ctx, text, sub) => String(text).startsWith(String(sub)),
        _string__ends_with: (_ctx, text, sub) => String(text).endsWith(String(sub)),
        _string__contains: (_ctx, text, sub) => String(text).includes(String(sub)),
        _string__replace: (_ctx, text, find, replacement) => String(find) === "" ? text
            : String(text).split(String(find)).join(String(replacement)),
        _string__split: (_ctx, text, by) => {
            const parts = String(text).split(String(by));
            while (parts.length && parts[parts.length - 1] === "") parts.pop();
            return parts;
        },
        _string__repeat: (_ctx, text, n) => {
            const count = Math.trunc(Number(n) || 0);
            return String(text).length * count > 5000 ? "[too large]" : String(text).repeat(Math.max(0, count));
        },
        _string__compare: (_ctx, a, b) => String(b) < String(a) ? -1 : String(b) > String(a) ? 1 : 0,
        _string__css_length_value: (_ctx, text) => cssLengthValue(String(text)),
        _string__css_multiply_length: (_ctx, text, multiplier) => {
            const match = /(\d+)(.+)/.exec(String(text));
            return cssLengthValue(`${Number(match?.[1] ?? 0) * Number(multiplier)}${match?.[2] ?? ""}`);
        },
        _string__css_divide_length: (_ctx, text, divisor) => {
            const match = /(\d+)(.+)/.exec(String(text));
            return cssLengthValue(`${Math.trunc(Number(match?.[1] ?? 0) / Number(divisor))}${match?.[2] ?? ""}`);
        },
        _string__css_string: (_ctx, text) => cssString(String(text)),
        _string__css_url_value: (_ctx, text) => {
            const value = String(text);
            if (!/^https?:\/\//.test(value) || /[^a-z0-9A-Z.@$\-_+!*'(),&=#;:?/%~]/.test(value)) return "";
            return `url(${cssString(value)})`;
        },
        _string__css_keyword: (_ctx, text, allowed) => cssKeyword(String(text), allowed),
        _string__css_keyword_list: (_ctx, text, allowed) => String(text).trim().split(/\s+/)
            .map(word => cssKeyword(word, allowed ? new Set(allowed) : undefined)).filter(Boolean).join(" "),

        // Colors
        _Color__clone: (_ctx, c) => ({ ...c }),
        _Color__set_hsl: (_ctx, c, h, s, l) => {
            [c.$h, c.$s, c.$l, c.$hslset] = [mod256(h), mod256(s), mod256(l), true];
            updateRgb(c);
        },
        _Color__red: channel("_r"), _Color__green: channel("_g"), _Color__blue: channel("_b"),
        _Color__hue: hslChannel("$h"), _Color__saturation: hslChannel("$s"), _Color__lightness: hslChannel("$l"),
        _Color__inverse: (_ctx, c) => color(255 - c._r, 255 - c._g, 255 - c._b),
        _Color__average: (_ctx, c, other) => color(...([["_r"], ["_g"], ["_b"]] as const)
            .map(([key]) => Math.trunc((c[key] + other[key]) / 2 + 0.5)) as [number, number, number]),
        _Color__blend: (_ctx, c, other, value) => {
            const m = Number(value) / 100;
            return color(...(["_r", "_g", "_b"] as const)
                .map(key => Math.trunc(c[key] - (c[key] - other[key]) * m + 0.5)) as [number, number, number]);
        },
        _Color__lighter: shade(1),
        _Color__darker: shade(-1),
        _PalItem: (_ctx, index, c) => c && c[".type"] === "Color" && index >= 0 && index <= 255
            ? s2("PalItem", { color: c, index: Number(index) }) : undefined,
        _palimg_modify: (_ctx, filename, items) => {
            const url = palimg(String(filename));
            if (!url || !items?.length) return url;
            if (items.length > 7) return undefined;
            return url + "/p" + items.map((item: S2Object) => Number(item._index).toString(16) +
                hex2(item._color._r) + hex2(item._color._g) + hex2(item._color._b)).join("");
        },
        _palimg_tint: (_ctx, filename, bright, dark) => {
            const url = palimg(String(filename));
            if (!url) return undefined;
            return url + "/pt" + [bright, dark].filter(Boolean).map((c: S2Object) => hex2(c._r) + hex2(c._g) + hex2(c._b)).join("");
        },
        _palimg_gradient: (_ctx, filename, start, end) => {
            const url = palimg(String(filename));
            if (!url) return undefined;
            return url + "/pg" + [start, end].filter(Boolean).map((item: S2Object) => hex2(item._index) +
                hex2(item._color._r) + hex2(item._color._g) + hex2(item._color._b)).join("");
        },

        // Dates
        _Date__day_of_week: (_ctx, time) => dayOfWeek(time),
        _DateTime__day_of_week: (_ctx, time) => dayOfWeek(time),
        _Date__compare: (_ctx, a, b) => compareDates(a, b),
        _DateTime__compare: (_ctx, a, b) => compareDates(a, b),
        _Date__date_format: (ctx, time, format, asLink) => formatTime(ctx, time, "date", format || "short", truthy(asLink)),
        _DateTime__date_format: (ctx, time, format, asLink) => formatTime(ctx, time, "date", format || "short", truthy(asLink)),
        _DateTime__time_format: (ctx, time, format) => formatTime(ctx, time, "time", format || "short", false),
        _YearMonth__month_format: (ctx, time, format, asLink) => formatTime(ctx, time, "month", format || "long", truthy(asLink)),

        // Users
        _UserLite: (_ctx, name) => state.userLite(String(name)),
        _UserLite__ljuser: (_ctx, user, linkColor) => state.chrome.ljuser(user.$userid, linkColor?._as_string ?? ""),
        _User__ljuser: (_ctx, user, linkColor) => state.chrome.ljuser(user.$userid, linkColor?._as_string ?? ""),
        _userlite_as_string: (_ctx, user) => state.chrome.ljuser(user.$userid, ""),
        _UserLite__equals: (_ctx, a, b) => a.$userid === b.$userid,
        _User__equals: (_ctx, a, b) => a.$userid === b.$userid,
        _UserLite__get_link: (ctx, user, key) => state.chrome.userLink(props(ctx), user, String(key)),
        _User__get_link: (ctx, user, key) => state.chrome.userLink(props(ctx), user, String(key)),
        _userlite_base_url: (_ctx, user) => user?.$base ?? "#",

        // Entries and comments
        _EntryLite__get_link: (ctx, item, key) => getLink(ctx, item, String(key)),
        _Entry__get_link: (ctx, item, key) => getLink(ctx, item, String(key)),
        _Comment__get_link: (ctx, item, key) => getLink(ctx, item, String(key)),
        _EntryLite__formatted_subject: formattedSubject,
        _Entry__formatted_subject: formattedSubject,
        _Comment__formatted_subject: formattedSubject,
        _EntryLite__get_plain_subject: (_ctx, item) => item.$subject_all ?? item._subject,
        _Entry__get_plain_subject: (_ctx, item) => item.$subject_all ?? item._subject,
        _Comment__get_plain_subject: (_ctx, item) => item.$subject_all ?? item._subject,
        _Entry__plain_subject: (_ctx, item) => item.$subject_all ?? item._subject,
        _EntryLite__get_tags_text: (ctx, item) => state.chrome.tagsText(props(ctx), item._tags ?? []),
        _Entry__get_tags_text: (ctx, item) => state.chrome.tagsText(props(ctx), item._tags ?? []),
        _EntryLite__print_reply_link: printReplyLink,
        _Entry__print_reply_link: printReplyLink,
        _EntryPage__print_reply_link: printReplyLink,
        _Comment__print_reply_link: (ctx, item, opts = {}) =>
            printReplyLink(ctx, item, { ...opts, basesubject: item._subject, target: opts.target || item._talkid }),
        _EntryLite__print_reply_container: printReplyContainer,
        _Entry__print_reply_container: printReplyContainer,
        _Comment__print_reply_container: printReplyContainer,
        _EntryPage__print_reply_container: printReplyContainer,
        _Comment__print_multiform_check: (ctx, item) => pout(ctx,
            `<input type='checkbox' name='selected_${Number(item._talkid) >> 8}' class='ljcomsel' id='ljcomsel_${item._talkid}' />`),
        _Comment__expand_link: expandLink,
        _Comment__print_expand_link: (ctx, item, opts) => pout(ctx, expandLink(ctx, item, opts)),
        _Comment__print_hide_link: (ctx, item, opts = {}) => {
            const { text, attrs } = commentLinkText(ctx, item, opts, ehtml(pluralPhrase(ctx, item._showable_children, "text_comment_hide")));
            pout(ctx, `<a href='#cmt${item._talkid}'${attrs} onClick="Expander.hideComments(this, '${item._talkid}'); return false;">${text}</a>`);
        },
        _Comment__print_unhide_link: (ctx, item, opts = {}) => {
            const { text, attrs } = commentLinkText(ctx, item, opts, ehtml(pluralPhrase(ctx, item._showable_children, "text_comment_unhide")));
            pout(ctx, `<a href='${item._expand_url}'${attrs} onClick="Expander.unhideComments(this, '${item._talkid}'); return false;">${text}</a>`);
        },
        _EntryPage__print_multiform_actionline: () => {},
        _EntryPage__print_multiform_end: () => {},
        _EntryPage__print_multiform_start: () => {},
        _ItemRange__url_of: (_ctx, range, n) => typeof range.$url_of === "function" ? range.$url_of(Number(n)) : "",
        _Image__set_url: (_ctx, img, url) => { img._url = eurl(url); },
        _ReplyForm__print: ctx => pout(ctx, state.chrome.replyForm()),

        // Siteviews layers only run inside the site scheme.
        _Siteviews__need_res: () => { throw new Error("Siteviews doesn't work standalone"); },
        _Siteviews__start_capture: () => { throw new Error("Siteviews doesn't work standalone"); },
        _Siteviews__end_capture: () => { throw new Error("Siteviews doesn't work standalone"); },
        _Siteviews__set_content: () => { throw new Error("Siteviews doesn't work standalone"); },
    };

    // set_handler
    function setHandler(ctx: Context, hook: string, statements: unknown[][]): void {
        if (!/^\w+#?$/.test(hook)) return;
        let js = `<script> function userhook_${hook.replace(/#$/, "ARG")} () {\n`;
        for (const [command, ...args] of statements ?? []) {
            const domExpression = () => {
                let id = String(args.shift() ?? "");
                let expression = "";
                while (id !== "") {
                    if (expression) expression += " + ";
                    const word = /^(\w+)/.exec(id);
                    if (word) { expression += `"${word[1]}"`; id = id.slice(word[1]!.length); }
                    else if (id.startsWith("#")) { expression += "arguments[0]"; id = id.slice(1); }
                    else return undefined;
                }
                return expression;
            };
            if (command === "style_bgcolor" || command === "style_color") {
                const expression = domExpression();
                const value = String(args.shift() ?? "");
                const valid = /^#[0-9a-f]{3}$/.test(value) || /^#[0-9a-f]{6}$/.test(value) || /^\w+$/.test(value) ||
                    /^rgb(\d+,\d+,\d+)$/.test(value);
                if (expression && valid) js += `setStyle(${expression}, '${command === "style_bgcolor" ? "background" : "color"}', '${value}');\n`;
            } else if (command === "set_class") {
                const expression = domExpression();
                const cls = String(args.shift() ?? "");
                if (expression && /^\w+$/.test(cls)) js += `setAttr(${expression}, 'class', '${cls}');\n`;
            } else if (command === "set_image") {
                const expression = domExpression();
                const url = String(args.shift() ?? "");
                if (/^https?:\/\//.test(url) && !/['"\n\r]/.test(url)) js += `setAttr(${expression}, 'src', "${eurl(url)}");\n`;
            }
        }
        pout(ctx, js + "} </script>\n");
    }

    return functions as Record<string, BuiltinFunction>;
}

// LJ::S2::has_quickreply
export function hasQuickreply(page: S2Object): boolean {
    return ["entry", "read", "day", "recent", "network"].includes(page._view);
}

function compareDates(a: S2Object, b: S2Object): number {
    for (const key of ["_year", "_month", "_day", "_hour", "_min", "_sec"]) {
        const diff = Number(b[key] ?? 0) - Number(a[key] ?? 0);
        if (diff) return Math.sign(diff);
    }
    return 0;
}

function mod256(value: unknown): number {
    return ((Math.trunc(Number(value)) % 256) + 256) % 256;
}

// S2::Color::rgb_to_hsl
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B), min = Math.min(R, G, B), delta = max - min;
    if (delta === 0) return [0, 0, max];
    const L = (max + min) / 2;
    const S = L < 0.5 ? delta / (max + min) : delta / (2 - max - min);
    let H = R === max ? (G - B) / delta : G === max ? 2 + (B - R) / delta : 4 + (R - G) / delta;
    H *= 60;
    if (H < 0) H += 360;
    if (H >= 360) H -= 360;
    return [H / 360, S, L];
}

// S2::Color::hsl_to_rgb
function hslToRgb(H: number, S: number, L: number): [number, number, number] {
    if (S < 0.0000000000001) {
        const v = Math.trunc(255 * L + 0.5);
        return [v, v, v];
    }
    const t2 = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const t1 = 2 * L - t2;
    const fromHue = (hue: number) => {
        if (hue < 0) hue += 1;
        if (hue > 1) hue -= 1;
        if (6 * hue < 1) return t1 + (t2 - t1) * hue * 6;
        if (2 * hue < 1) return t2;
        if (3 * hue < 2) return t1 + (t2 - t1) * (2 / 3 - hue) * 6;
        return t1;
    };
    return [H + 1 / 3, H, H - 1 / 3].map(hue => Math.trunc(255 * fromHue(hue) + 0.5)) as [number, number, number];
}
