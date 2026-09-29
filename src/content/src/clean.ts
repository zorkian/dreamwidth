// clean.ts
//
// A port of LJ::CleanHTML::clean, the token-by-token HTML cleaner behind
// entries, comments and subjects.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { cleanCss } from "./css";
import { checkIframeEmbed } from "./embed-whitelist";
import { type StylesheetSettings, cleanLink, cleanMeta } from "./html-cleaner";
import { markdown } from "./markdown";
import { canonicalUsername, ehtml, eurl } from "./text";
import { type Token, TokenStream, tokenize } from "./tokens";

// Site settings the cleaner needs.
export interface CleanSite extends StylesheetSettings {
    readonly siteRoot: string;
    readonly imgPrefix: string;
    readonly isDevServer: boolean;
    readonly knownHttpsSites: readonly string[];
    readonly formDomainBanned: readonly string[];
    readonly placeholder: { readonly src: string; readonly width: number; readonly height: number; readonly alt: string };
    // Site text, by LJ::Lang key.
    readonly strings: Readonly<Record<string, string>>;
}

export interface UserTagOptions {
    readonly textonly: boolean;
    readonly noLink: boolean;
    readonly noLjuserClass: boolean;
}

// Lookups that need the database. The caller loads what the text refers to
// beforehand; see userReferences.
export interface CleanHooks {
    // The user tag for a local account, or undefined if there is none.
    user?(name: string, options: UserTagOptions): string | undefined;
    // The user tag for an account on another site, or undefined if the site is unknown.
    externalUser?(name: string, site: string, options: UserTagOptions): string | undefined;
}

export interface CleanOptions {
    addbreaks?: boolean;
    keepcomments?: boolean;
    mode: "allow" | "deny";
    allow?: readonly string[];
    eat?: readonly string[];
    deny?: readonly string[];
    remove?: readonly string[];
    conditional?: readonly string[];
    rewrite_embed_param?: boolean;
    force_https_embed?: boolean;
    attrstrip?: readonly string[];
    nodwtags?: boolean;
    cuturl?: string;
    cutpreview?: string;
    ljcut_disable?: boolean;
    extractlinks?: boolean;
    noautolinks?: boolean;
    noexpandembedded?: boolean;
    textonly?: boolean;
    remove_colors?: boolean;
    remove_sizes?: boolean;
    remove_abs_sizes?: boolean;
    remove_fonts?: boolean;
    remove_positioning?: boolean;
    at_mentions?: boolean;
    formatting?: "html" | "markdown";
    noearlyclose?: boolean;
    cleancss?: boolean;
    strongcleancss?: boolean;
    nocss?: boolean;
    maximgwidth?: number;
    maximgheight?: number;
    imageplaceundef?: boolean;
    extractimages?: boolean;
    suspend_msg?: boolean;
    to_external_site?: boolean;
    preserve_lj_tags_for?: string;
    cut_retrieve?: number;
    journal?: string;
    ditemid?: number | string;
    blocked_links?: readonly RegExp[];
    blocked_link_substitute?: string;
}

// Tags that may close themselves (HTML5 void elements, plus our own).
const SLASHCLOSE = /^(?:area|base|basefont|br|col|embed|frame|hr|img|input|isindex|link|meta|param|source|track|wbr|lj-embed|site-embed|poll-\d+|lj-poll-\d+)$/i;
const TAG_UPDATES: Record<string, string> = {
    "cut": "lj-cut", "poll": "lj-poll", "poll-item": "lj-pi", "poll-question": "lj-pq",
    "raw-code": "lj-raw", "site-embed": "lj-embed", "user": "lj",
};
const FORM_TAGS = new Set(["input", "select", "option"]);
const TABLE_PARTS = /^(?:tbody|thead|tfoot|tr|td|th|caption|colgroup|col)$/;

export function clean(html: string, opts: CleanOptions, site: CleanSite, hooks: CleanHooks = {}): string {
    let data = stripRequestAuth(html);
    let addbreaks = !!opts.addbreaks;
    const nodwtags = !!opts.nodwtags;
    let cut = nodwtags ? "" : opts.cuturl || opts.cutpreview || "";
    const extractlinks = !!opts.extractlinks;
    const noexpandEmbedded = !!(opts.noexpandembedded || opts.textonly);
    const atMentions = !!opts.at_mentions && !nodwtags;
    const formatting = opts.formatting ?? "html";
    const autoLinks = !(extractlinks || opts.noautolinks) && formatting === "html";
    const blockedLinks = opts.blocked_links ?? [];
    const blockedSubstitute = opts.blocked_link_substitute ?? "#";
    const journal = opts.journal ?? "";
    const ditemid = opts.ditemid ?? "";

    const action: Record<string, "allow" | "eat" | "deny" | "conditional"> = {};
    const remove = new Set<string>();
    for (const tag of opts.allow ?? []) action[tag] = "allow";
    for (const tag of opts.eat ?? []) action[tag] = "eat";
    for (const tag of opts.deny ?? []) action[tag] = "deny";
    for (const tag of opts.remove ?? []) { action[tag] = "deny"; remove.add(tag); }
    for (const tag of opts.conditional ?? []) action[tag] = "conditional";
    action.script = "eat";
    if (opts.remove_sizes) {
        for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) { action[tag] = "deny"; remove.add(tag); }
    }
    const cleancss = !!(opts.cleancss || opts.strongcleancss);
    const attrstrip: string[] = [];
    if (cleancss) attrstrip.push("id");
    if (opts.nocss) attrstrip.push("style");
    attrstrip.push(...opts.attrstrip ?? []);

    if (formatting === "markdown") {
        data = markdown(data);
        addbreaks = false;
    }

    const p = new TokenStream(tokenize(data));
    const canonicalUrls: string[] = [];
    const opencount: Record<string, number> = { td: 0, th: 0 };
    const count = (tag: string) => opencount[tag] ?? 0;
    const tablescope: Record<string, number>[] = [];
    let cutcount = 0;
    let out = "";
    let extraText: string | undefined;

    const totalFail = (tag: string) => {
        if (cut) {
            extraText = `<strong>${ml(site, "cleanhtml.error.markup", { aopts: `href='${ehtml(cut)}'` })}</strong>`;
        } else {
            let edata = ehtml(data);
            if (addbreaks) edata = edata.replace(/\r?\n/g, "<br />");
            extraText = ml(site, "cleanhtml.error.markup.extra", { aopts: ehtml(tag) }) +
                `<br /><br /><div style="width: 95%; overflow: auto">${edata}</div>`;
        }
        extraText = `<div class='ljparseerror'>${extraText}</div>`;
    };

    let eatingLjuserSpan = false;
    let ljuserTextNode = "";
    const eatuntil: string[] = [];
    let capturing: (() => void) | undefined;
    const tagstack: string[] = [];
    let disableUserConversion = false;
    const startCapture = (tag: string, done: () => void) => {
        if (capturing) return;
        eatuntil.push(tag);
        capturing = done;
    };
    const update = (tag: string) => TAG_UPDATES[tag] ?? tag;
    const usertagOpts = () => ({
        textonly: !!opts.textonly, noLink: count("a") > 0, noLjuserClass: !!opts.to_external_site,
    });
    const userLink = (user: string | undefined, userSite?: string) =>
        userLinkHtml(user, userSite, usertagOpts(), site, hooks, opts.preserve_lj_tags_for);

    const cuttagStack: string[] = [];
    let eatall = !!opts.cut_retrieve;

    for (let token = p.next(); token; token = p.next()) {
        if (token.type === "S") {
            let tag = update(token.tag);
            const attr = { ...token.attrs };
            let ljcutDiv = tag === "div" && (attr.class ?? "").toLowerCase() === "ljcut";

            if (eatuntil.length) {
                if (tag === "lj-cut" || ljcutDiv) cutcount++;
                if (tag === eatuntil.at(-1)) eatuntil.push(tag);
                continue;
            }
            if (eatall && tag !== "lj-cut" && !ljcutDiv) continue;

            if (tag === "lj-template" && !noexpandEmbedded && !nodwtags) {
                const name = (attr.name ?? "").replaceAll("-", "_");
                const error = () => {
                    out += `<strong>${ml(site, "cleanhtml.error.template", { aopts: ehtml(name) })}</strong>`;
                };
                if (token.selfClosing) error();
                else startCapture("lj-template", error);
                continue;
            }
            if (opts.rewrite_embed_param) {
                if (tag === "embed" && attr.allowscriptaccess !== undefined && attr.allowscriptaccess !== "never") {
                    attr.allowscriptaccess = "sameDomain";
                }
                if (tag === "param" && count("object") && (attr.name ?? "").toLowerCase() === "allowscriptaccess" &&
                    attr.value !== "never") {
                    attr.value = "sameDomain";
                }
            }
            if (tag === "span" && (attr.class ?? "").toLowerCase() === "ljuser" && !noexpandEmbedded && !nodwtags) {
                eatingLjuserSpan = true;
                ljuserTextNode = "";
            }
            if (eatingLjuserSpan) continue;
            if ((tag === "div" || tag === "span") && (attr.class ?? "").toLowerCase() === "ljvideo") {
                startCapture(tag, () => {
                    out += `<strong>${ml(site, "cleanhtml.error.template.video")}</strong>`;
                });
                continue;
            }
            // An email address or URL written as a tag is shown as text.
            if (/@|:\/\//.test(tag)) {
                out += ehtml(`<${tag}>`);
                continue;
            }
            if (FORM_TAGS.has(tag)) {
                if (!count("form")) {
                    out += `&lt;${tag} ... &gt;`;
                    continue;
                }
                if (tag === "input" && (!/^\w+$/.test(attr.type ?? "") || (attr.type ?? "").toLowerCase() === "password")) {
                    delete attr.type;
                }
            }

            let slashclose = token.selfClosing;
            if (!/^\w([\w\-:_]*\w)?$/.test(tag)) {
                totalFail(tag);
                break;
            }
            // Eating skips to the matching end tag even after <tag />.
            if (action[tag] === "eat") {
                p.skipPast(tag);
                continue;
            }
            let forceAllow = false;
            if (action[tag] === "conditional" && tag === "iframe") {
                const embed = checkIframeEmbed(attr.src);
                forceAllow = embed.allow;
                if (opts.force_https_embed && embed.canHttps) attr.src = attr.src!.replace(/^https?:/, "");
                if (!forceAllow) {
                    // Perl skips unless the tag has a "/" attribute; HTML::Parser names <iframe/> "iframe/".
                    if (!token.selfClosing || token.text[token.tag.length + 1] === "/") p.skipPast(tag);
                    continue;
                }
                // Links can target a named frame.
                delete attr.name;
            }
            if (tag === "meta" && !cleanMeta(attr)) continue;
            if (tag === "link" && !cleanLink(attr, site)) continue;

            // The rich text editor's user tag markup.
            if (tag === "div" && attr.class === "ljuser" && !nodwtags) {
                let text = p.textUntil("b");
                p.skipPast("div");
                text = text.replace(/\[[^\]]+\]/, "");
                tag = "lj";
                attr.user = text;
            }
            if (ljcutDiv && opts.ljcut_disable) ljcutDiv = false;
            if (tag === "blockquote" && attr.class === "twitter-tweet") disableUserConversion = true;

            if ((tag === "lj-cut" || ljcutDiv) && !nodwtags) {
                if (opts.ljcut_disable) continue;
                cutcount++;
                if (eatall) {
                    if (cutcount === opts.cut_retrieve) {
                        eatall = false;
                        cuttagStack.push(tag);
                    }
                    continue;
                }
                const linkText = () => attr.text
                    ? attr.text.replaceAll("<", "&lt;").replaceAll(">", "&gt;") : "Read more...";
                if (opts.preserve_lj_tags_for) {
                    opencount["lj-cut"] = count("lj-cut") + 1;
                    out += "<lj-cut" + (attr.text ? ` text="${linkText()}"` : "") + ">";
                    continue;
                } else if (cut) {
                    const id = `${journal}_${ditemid}_${cutcount}`;
                    if (tag === "div") out += "<div>";
                    out += `<span class="cut-wrapper"><span style="display: none;" id="span-cuttag_${id}" class="cuttag"></span>` +
                        `<b class="cut-open">(&nbsp;</b><b class="cut-text"><a href="${ehtml(cut)}#cutid${cutcount}">${linkText()}</a>` +
                        `</b><b class="cut-close">&nbsp;)</b></span>` +
                        `<div style="display: none;" id="div-cuttag_${id}" aria-live="assertive"></div>`;
                    if (tag === "div") out += "</div>";
                    if (!opts.cutpreview) {
                        eatuntil.push(tag);
                        continue;
                    }
                } else {
                    if (!opts.textonly) out += `<a name="cutid${cutcount}"></a>`;
                    if (tag === "div" && !opts.textonly) {
                        opencount.div = count("div") + 1;
                        out += `<div class="ljcut" text="${linkText()}">`;
                    }
                    continue;
                }
            } else if (tag === "style") {
                let style = p.textUntil("style");
                p.skipPast("style");
                if (site.cssCleaner) {
                    style = cleanCss(style);
                    if (site.isDevServer) style = "/* cleaned */\n" + style;
                }
                out += `\n<style>\n${style}</style>\n`;
                continue;
            } else if (tag === "lj" && !nodwtags) {
                const user = attr.name ?? attr.user ?? attr.comm;
                out += userLink(user, attr.site);
            } else if (tag === "lj-raw" && !nodwtags) {
                opencount[tag] = count(tag) + 1;
            } else if (/:set$/.test(tag)) {
                continue;
            } else {
                let altOutput = false;
                const hash = attr;
                for (const name of attrstrip) {
                    if (tag === "lj-embed" && name === "id") continue;
                    delete hash[name];
                }
                if (tag === "form") {
                    const formAction = (hash.action ?? "").toLowerCase();
                    const host = /^https?:\/\/?([^/]+)/.exec(formAction)?.[1];
                    if (!host || /[%@\s]/.test(host) || site.formDomainBanned.includes(host)) delete hash.action;
                }

                let failed = false;
                for (const name of Object.keys(hash)) {
                    if (/^(?:on|dynsrc)/.test(name)) { delete hash[name]; continue; }
                    if (name === "data") {
                        delete hash[name];
                        delete hash.type;
                        continue;
                    }
                    if (/(?:^=)|[\x0b\x0d]/.test(name) || !/^[\w_:-]+$/.test(name)) {
                        totalFail(`${tag} ${Object.keys(hash).length > 1 ? "[...] " : ""}${name}`);
                        failed = true;
                        break;
                    }
                    hash[name] = hash[name]!.replace(/[\t\n]/g, "").replaceAll("\0", "");
                    if (/(?:jscript|livescript|javascript|vbscript|^about|data):/i.test(hash[name]!.replace(/[\s\x0b]+/g, ""))) {
                        delete hash[name];
                        continue;
                    }
                    if (name === "style") {
                        if (cleancss && !cleanStyleAttribute(hash, opts, extractlinks)) continue;
                        if (cleancss && site.cssCleaner) hash.style = cleanCss(hash.style!);
                    }
                    if ((name === "class" || name === "id") && opts.strongcleancss) { delete hash[name]; continue; }
                    if (name === "id" && /^ljs_/i.test(hash[name]!)) { delete hash[name]; continue; }
                    const removeAttr: Record<string, boolean> = {
                        color: !!opts.remove_colors, bgcolor: !!opts.remove_colors, fgcolor: !!opts.remove_colors,
                        text: !!opts.remove_colors, size: !!opts.remove_sizes, face: !!opts.remove_fonts,
                    };
                    if (removeAttr[name]) delete hash[name];
                }
                if (failed) break;

                if (hash.href !== undefined) {
                    for (const re of blockedLinks) {
                        if (re.test(hash.href)) {
                            hash.href = blockedSubstitute.replace("%s", eurl(hash.href));
                            break;
                        }
                    }
                    const lj = /^(?:lj|site):(?:\/\/)?(.*)$/i.exec(hash.href);
                    hash.href = lj ? expandLjUrl(lj[1]!, site) : canonicalUrl(hash.href, true);
                }

                if (tag === "img") {
                    let bad = false;
                    if (opts.maximgwidth !== undefined && Number(hash.width) > opts.maximgwidth) bad = true;
                    if (opts.maximgheight !== undefined && Number(hash.height) > opts.maximgheight) bad = true;
                    if (hash.width === undefined || hash.height === undefined) bad ||= !!opts.imageplaceundef;
                    if (opts.extractimages) bad = true;
                    const sanitize = (url: string) => {
                        const canonical = canonicalUrl(url, true);
                        return opts.to_external_site ? canonical : httpsUrl(canonical, site);
                    };
                    hash.src = sanitize(hash.src ?? "");
                    if (hash.srcset !== undefined) hash.srcset = hash.srcset.replace(/\b(http:\/\/\S+)/gi, url => sanitize(url));
                    if (bad) {
                        out += `<a class="ljimgplaceholder" href="${ehtml(hash.src)}">${placeholderImage(site)}</a>`;
                        altOutput = true;
                        opencount.img = count("img") + 1;
                    }
                }
                if (tag === "a" && extractlinks) {
                    canonicalUrls.push(canonicalUrl(token.attrs.href ?? "", true));
                    out += "<b>";
                    continue;
                }
                // xsl can define script elements.
                if (tag === "xsl:attribute") {
                    altOutput = true;
                    const value = p.textUntil();
                    if (/(javascript|vbscript)/i.test(value.replace(/\s+/g, ""))) {
                        p.next();
                        p.textUntil();
                    } else {
                        out += token.text + value;
                    }
                }

                if (!altOutput) {
                    let allow = opts.mode !== "allow" ? action[tag] === "allow"
                        : action[tag] === "conditional" ? forceAllow : action[tag] !== "deny";
                    if (allow && !remove.has(tag)) {
                        if ((TABLE_PARTS.test(tag) && !tablescope.length) ||
                            (/^(?:td|th)$/.test(tag) && !tablescope.at(-1)?.tr) ||
                            (tag === "table" && tablescope.length && !(tablescope.at(-1)!.td || tablescope.at(-1)!.th))) {
                            allow = false;
                        }
                        out += allow ? `<${tag}` : `&lt;${tag}`;
                        for (const name of token.order) {
                            if (name in hash && name !== "/") out += ` ${name}="${ehtml(hash[name])}"`;
                        }
                        if (slashclose) {
                            if (SLASHCLOSE.test(tag)) {
                                out += " /";
                                opencount[tag] = count(tag) - 1;
                                if (tablescope.length) tablescope.at(-1)![tag] = (tablescope.at(-1)![tag] ?? 0) - 1;
                            } else {
                                slashclose = false;
                            }
                        }
                        if (allow) {
                            out += ">";
                            opencount[tag] = count(tag) + 1;
                            if (tag === "table") tablescope.push({});
                            else if (tablescope.length) tablescope.at(-1)![tag] = (tablescope.at(-1)![tag] ?? 0) + 1;
                            if (!slashclose && (tag === "table" || !tablescope.length)) tagstack.push(tag);
                        } else {
                            out += "&gt;";
                        }
                    }
                }
            }
        } else if (token.type === "E") {
            const tag = update(token.tag);
            if (/[^\w\-:]/.test(tag)) continue;
            if (eatuntil.length) {
                if (eatuntil.at(-1) === tag) {
                    eatuntil.pop();
                    if (capturing && !eatuntil.length) {
                        capturing();
                        capturing = undefined;
                    }
                }
                continue;
            }
            if (cuttagStack.length && cuttagStack.at(-1) === tag) {
                cuttagStack.pop();
                if (!cuttagStack.length) break;
            }
            if (eatall) continue;
            if (eatingLjuserSpan) {
                if (tag === "span") {
                    eatingLjuserSpan = false;
                    out += userLink(ljuserTextNode);
                }
                continue;
            }
            if (disableUserConversion && tag === "blockquote") disableUserConversion = false;

            if (tag === "lj-raw" && !nodwtags) {
                opencount[tag] = count(tag) - 1;
                if (tablescope.length) tablescope.at(-1)![tag] = (tablescope.at(-1)![tag] ?? 0) - 1;
            } else if (tag === "lj-cut" && !nodwtags) {
                if (opts.preserve_lj_tags_for && count("lj-cut")) {
                    opencount["lj-cut"] = count("lj-cut") - 1;
                    out += "</lj-cut>";
                } else if (opts.cutpreview) {
                    out += "<b>&lt;/cut&gt;</b>";
                }
            } else {
                let allow = opts.mode === "allow"
                    ? action[tag] !== "deny" && action[tag] !== "conditional"
                    : action[tag] === "allow";
                if (extractlinks && tag === "a" && canonicalUrls.length) {
                    out += `</b> (${ehtml(canonicalUrls.pop())})`;
                    continue;
                }
                if (allow && !remove.has(tag)) {
                    if ((/^(?:table|tbody|thead|tfoot|tr|td|th|caption|colgroup|col)$/.test(tag) && !tablescope.length) ||
                        (/^(?:td|th)$/.test(tag) && !tablescope.at(-1)?.tr)) {
                        allow = false;
                    }
                    if (allow && !(opts.noearlyclose && !count(tag))) {
                        if (!tablescope.length) {
                            for (let close = tagstack.pop(); close !== undefined && close !== tag; close = tagstack.pop()) {
                                opencount[close] = count(close) - 1;
                                if (!SLASHCLOSE.test(close)) out += `</${close}>`;
                            }
                        }
                        if (tag === "table") {
                            tablescope.pop();
                            if (tagstack.at(-1) === "table") tagstack.pop();
                        } else if (tablescope.length) {
                            if (!tablescope.at(-1)![tag]) continue;
                            tablescope.at(-1)![tag]!--;
                        }
                        if (count(tag)) {
                            out += `</${tag}>`;
                            opencount[tag] = count(tag) - 1;
                        }
                    } else if (!allow || (FORM_TAGS.has(tag) && !count("form"))) {
                        out += `&lt;/${tag}&gt;`;
                    }
                }
                if (action[tag] === "conditional" && tagstack.at(-1) === tag) {
                    out += `</${tag}>`;
                    tagstack.pop();
                    opencount[tag] = count(tag) - 1;
                }
            }
        } else if (token.type === "D") {
            out += token.text.replace(/>.+/s, ">").replace(/.</gs, "");
        } else if (token.type === "T") {
            if (eatuntil.length || eatall) continue;
            if (eatingLjuserSpan) {
                ljuserTextNode = token.text;
                continue;
            }
            let text = token.text;
            const autoFormat = formatting === "html" && addbreaks && count("table") <= count("td") + count("th") &&
                !count("pre") && !count("textarea") && !count("lj-raw");
            const urls: string[] = [];
            if (autoFormat && autoLinks && !count("a")) {
                text = text.replace(/(https?:\/\/[^\s'"<>]+[a-zA-Z0-9_/&=\-])/g, match => {
                    const trailing = /^(.*?)(&(#39|quot|lt|gt)(;.*)?)$/.exec(match);
                    const url = trailing ? trailing[1]! : match;
                    urls.push(url);
                    return `&url${urls.length};${url}&urlend;${trailing ? trailing[2] : ""}`;
                });
            }
            text = text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
            if (autoFormat) {
                text = text.replace(/\r?\n/g, "<br />");
                if (!count("a")) text = text.replace(/&url(\d+);(.*?)&urlend;/g, (_, n, label) => `<a href="${urls[Number(n) - 1]}">${label}</a>`);
            }
            if (atMentions && !disableUserConversion && !count("code") && !count("pre") && !count("textarea") && !count("lj-raw")) {
                text = convertUserMentions(text, (user, userSite) => userLink(user, userSite));
            }
            out += text;
        } else if (token.type === "C") {
            if (/^<[^!]/.test(token.text)) {
                out += ehtml(token.text);
            } else if (opts.keepcomments) {
                const comment = token.text.replace(/^<!--\s*/, "").replace(/\s*--!>$/, "").replace("<!--", "").replace("-->", "");
                out += `<!-- ${comment} -->`;
            }
        } else if (token.type === "PI") {
            out += `<?${token.text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}>`;
        }
    }

    if (extractlinks) {
        for (const url of canonicalUrls) out += `</b> (${ehtml(url)})`;
    }
    if (count("textarea")) out += "</textarea>";
    opencount.textarea = 0;
    for (const tag of [...tagstack].reverse()) {
        if (SLASHCLOSE.test(tag)) continue;
        if (count(tag)) {
            out += `</${tag}>`;
            opencount[tag] = count(tag) - 1;
        }
    }
    if (opts.preserve_lj_tags_for) {
        while (count("lj-cut") > 0) {
            out += "</lj-cut>";
            opencount["lj-cut"] = count("lj-cut") - 1;
        }
    }
    while (/<script\b/i.test(out)) out = out.replace(/<script\b/gi, "");
    if (extraText) out += extraText;
    if (opts.suspend_msg) {
        out = `<div style="color: #000; font: 12px Verdana, Arial, Sans-Serif; background-color: #ffeeee; ` +
            `background-repeat: repeat-x; border: 1px solid #ff9999; padding: 8px; margin: 5px auto; width: auto; ` +
            `text-align: left; background-image: url('${site.imgPrefix}/message-error.gif');">` +
            `${ml(site, "cleanhtml.suspend_msg")}</div>` + out;
    }
    return out;
}

// The cleancss rules for a style attribute. False if the style was removed.
function cleanStyleAttribute(hash: Record<string, string>, opts: CleanOptions, extractlinks: boolean): boolean {
    let style = hash.style!.replaceAll("\\", "");
    for (const bad of ["/*", "[", "absolute", "fixed", "expression", "eval", "behavior", "cookie", "document", "window",
        "javascript", "-moz-binding"]) {
        if (style.toLowerCase().includes(bad)) {
            delete hash.style;
            return false;
        }
    }
    if (opts.strongcleancss && /-moz-|absolute|relative|outline|z-index|(?<!-)(?:top|left|right|bottom)\s*:|filter|-webkit-/i.test(style)) {
        delete hash.style;
        return false;
    }
    if (opts.remove_colors) style = style.replace(/(?:background-)?color:.*?(?:;|$)/gi, "");
    if (opts.remove_sizes) style = style.replace(/font-size:.*?(?:;|$)/gi, "");
    else if (opts.remove_abs_sizes) style = style.replace(/font-size:\s*?\d+.*?(?:;|$)/gi, "");
    if (opts.remove_fonts) style = style.replace(/font-family:.*?(?:;|$)/gi, "");
    if (opts.remove_positioning) {
        style = style.replace(/margin.*?(?:;|$)/gi, "").replace(/height\s*?:.*?(?:;|$)/gi, "")
            .replace(/display\s*?:\s*?none\s*?(?:;|$)/gi, "");
        const tooLarge = [...style.matchAll(/padding.*?:\s*?(.*?)(?:;|$)/gi)]
            .some(match => match[1]!.split(/\s+/).some(value => (parseInt(value) || 0) > 500));
        if (tooLarge) style = style.replace(/padding.*?(?:;|$)/gi, "");
    }
    if (extractlinks) style = style.replace(/url\(.*?\)/gi, "");
    hash.style = style;
    return true;
}

// LJ::strip_request_auth
function stripRequestAuth(text: string): string {
    return text.replace(/(see_request\S+?)&auth=\w+/gi, "$1");
}

// LJ::CleanHTML::canonical_url
export function canonicalUrl(url: string, allowAll = false): string {
    let text = (url ?? "").replace(/^\s*/, "").replace(/\s*$/, "");
    if (!text) return "";
    if (!allowAll) {
        const scheme = /^(https?|ftp|webcal):/.exec(text)?.[1] ?? "http";
        text = text.replace(/^.*?:\/*/, "");
        if (!text) return "";
        text = `${scheme}://${text}`;
    }
    return text;
}

// LJ::CleanHTML::https_url, without image proxying.
export function httpsUrl(url: string, site: CleanSite): string {
    if (/^(?:https:\/\/|\/\/)/.test(url)) return url;
    const domain = /^http:\/\/[^/]*?([^.]+\.\w{2,3})\//.exec(url)?.[1];
    if (domain && (domain === site.domain || site.knownHttpsSites.includes(domain))) return url.replace(/^http:/, "https:");
    return url;
}

// LJ::CleanHTML::ExpandLJURL
function expandLjUrl(path: string, site: CleanSite): string {
    const [mode, ...args] = path.split("/").filter(Boolean);
    const user = () => canonicalUsername(args[0] ?? "");
    const id = () => Math.trunc(Number(args[0]) || 0);
    const modes: Record<string, () => string> = {
        faq: () => id() ? `support/faqbrowse?faqid=${id()}` : "support/faq",
        memories: () => user() ? `memories?user=${user()}` : "memories",
        support: () => id() ? `support/see_request?id=${id()}` : "support/",
        user: () => {
            const rest = args.slice(1);
            if (rest.some(part => /["'<>\n&]/.test(part))) return "";
            return rest[0] === "profile" ? `profile?user=${user()}` : `users/${user()}/` + rest.map(part => `${part}/`).join("");
        },
        userinfo: () => user() ? `profile?user=${user()}` : "profile",
        userpics: () => user() ? `allpics?user=${user()}` : "allpics",
    };
    return `${site.siteRoot}/${mode && modes[mode] ? modes[mode]!() : "error:bogus-lj-url"}`;
}

// LJ::img('placeholder')
function placeholderImage(site: CleanSite): string {
    const { src, width, height, alt } = site.placeholder;
    return `<img src="${site.imgPrefix}${src}" width="${width}" height="${height}" alt="${alt}" title="${alt}" border='0' />`;
}

// LJ::CleanHTML::convert_user_mentions: @user and @user.site become user tags.
export function convertUserMentions(text: string, link: (user: string, site?: string) => string): string {
    const tag = (user: string, site?: string) => link(user, site);
    text = text.replace(/^(@([\w-]+)(?:\.([\w\-.]*[\w-]))?)(?=$|\W)/gm, (_, _all, user, site) => tag(user, site));
    return text.replace(/(\\.)|(?<=[^\w/])(@([\w-]+)(?:\.([\w\-.]*[\w-]))?)(?=$|\W)/gm,
        (_, escaped, _all, user, site) => escaped !== undefined ? (escaped === "\\@" ? "@" : escaped) : tag(user, site));
}

// LJ::CleanHTML::user_link_html
function userLinkHtml(user: string | undefined, userSite: string | undefined, options: UserTagOptions, site: CleanSite,
    hooks: CleanHooks, preserveFor?: string): string {
    if (userSite !== undefined && userSite !== site.domain) {
        if (preserveFor && userSite === preserveFor) return `<lj user="${user}">`;
        const html = user ? hooks.externalUser?.(user, userSite, options) : undefined;
        if (html !== undefined) return html;
        return `<b>[Bad username or site: ${ehtml(user)} @ ${ehtml(userSite)}]</b>`;
    }
    if (user) {
        const html = hooks.user?.(user, options);
        if (html !== undefined) return html;
        const name = canonicalUsername(user);
        if (name) return options.textonly ? name : unknownUserTag(name, options, site);
        return `<b>[Bad username or unknown identity: ${ehtml(user)}]</b>`;
    }
    return "<b>[Unknown site tag]</b>";
}

// LJ::ljuser for a name with no account.
function unknownUserTag(user: string, options: UserTagOptions, site: CleanSite): string {
    const profile = `${site.siteRoot}/profile?user=${user}`;
    const img = `<img src='${site.imgPrefix}/silk/identity/user.png' alt='[profile] ' width='17' height='17' ` +
        "style='vertical-align: text-bottom; border: 0; padding-right: 1px;' />";
    const cls = options.noLjuserClass ? "" : " class='ljuser'";
    const attr = options.noLjuserClass ? "" : ` lj:user='${user}'`;
    return options.noLink
        ? `<span${attr} style='white-space: nowrap;'${cls}>${img}<b>${user}</b></span>`
        : `<span${attr} style='white-space: nowrap;'${cls}><a href='${profile}'>${img}</a><a href='${profile}'><b>${user}</b></a></span>`;
}

// LJ::Lang::ml with [[name]] substitutions.
function ml(site: CleanSite, key: string, vars: Record<string, string> = {}): string {
    return (site.strings[key] ?? "").replace(/\[\[(\w+)\]\]/g, (_, name) => vars[name] ?? "");
}

export type { Token };
