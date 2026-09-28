// objects.ts
//
// Constructors for the S2 objects journal pages are built from, following
// LJ::S2's Entry, Image, Link, UserLite and related functions.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { SiteConfig } from "../server/config";
import type { Site, User } from "../data/user";
import type { Userpic } from "../data/userpic";

// Compiled S2 reads member `name` as `_name` and the class from `.type`.
// Keys starting with `$` hold host data that S2 code cannot see.
export type S2Object = Record<string, any>;

export function s2(type: string, fields: Record<string, unknown> = {}): S2Object {
    const object: S2Object = { ".type": type };
    for (const [name, value] of Object.entries(fields)) {
        if (name.startsWith("$")) object[name] = value;
        else object[`_${name}`] = value;
    }
    return object;
}

export function nullObject(type: string): S2Object {
    return { ".type": type, ".isnull": true };
}

// LJ::ehtml
export function ehtml(value: unknown): string {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
        .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// LJ::eurl
export function eurl(value: unknown): string {
    return [...Buffer.from(String(value ?? ""), "utf8")].map(byte => {
        const char = String.fromCharCode(byte);
        if (char === " ") return "+";
        return /[A-Za-z0-9_,\-./\\:]/.test(char) ? char : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }).join("");
}

export function Link(url: string, caption: unknown, icon: unknown = nullObject("Image"),
    extra: Record<string, unknown> = {}): S2Object {
    return s2("Link", { caption, url, icon, extra });
}

export function Image(url: string, width: unknown, height: unknown, alttext: unknown,
    extra: Record<string, unknown> = {}): S2Object {
    return s2("Image", { url, width, height, alttext, extra });
}

// Image_std: the standard site images. Some alt texts come from the style.
const STYLE_ALT_TEXT: Record<string, string> = {
    "security-protected": "text_icon_alt_protected",
    "security-private": "text_icon_alt_private",
    "security-groups": "text_icon_alt_groups",
    "adult-nsfw": "text_icon_alt_nsfw",
    "adult-18": "text_icon_alt_18",
    "sticky-entry": "text_icon_alt_sticky_entry",
    "admin-post": "text_icon_alt_admin_post",
};

export function ImageStd(config: SiteConfig, props: Record<string, unknown>, name: string): S2Object | undefined {
    const image = config.images[name];
    if (!image) return undefined;
    const alt = STYLE_ALT_TEXT[name] ? props[`_${STYLE_ALT_TEXT[name]}`] : image.alt;
    return Image(config.imgPrefix.replace(/^https?:/, "") + image.src, image.width, image.height, alt);
}

// Image_userpic
// Marked as the default when `markDefault` says so, or else when no keyword is given.
export function ImageUserpic(config: SiteConfig, owner: User, pic: Userpic | undefined, keyword?: string,
    markDefault?: boolean): S2Object {
    if (!pic) return nullObject("Image");
    const description = pic.description;
    const isDefault = markDefault ?? keyword === undefined;
    const alt = `${owner.user}:${description ? " " + description : ""}` +
        (keyword !== undefined ? ` (${keyword})` : "") + (isDefault ? " (Default)" : "");
    const title = `${owner.user}:${keyword !== undefined ? " " + keyword : ""}${isDefault ? " (Default)" : ""}` +
        (description ? ` (${description})` : "");
    return Image(`${config.userpicRoot}/${pic.picid}/${owner.userid}`, pic.width, pic.height, ehtml(alt),
        { title: ehtml(title) });
}

export function DateTimeParts(parts: string): S2Object {
    const [year, month, day, hour, min, sec, dayofweek] = parts.split(/\s+/).map(Number);
    return s2("DateTime", {
        year: year ?? 0, month: month ?? 0, day: day ?? 0, hour: hour ?? 0, min: min ?? 0, sec: sec ?? 0,
        ...(dayofweek !== undefined ? { dayofweek: dayofweek + 1 } : {}),
    });
}

export function DateTimeUnix(seconds: number): S2Object {
    const d = new Date(seconds * 1000);
    return s2("DateTime", {
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
        hour: d.getUTCHours(), min: d.getUTCMinutes(), sec: d.getUTCSeconds(), dayofweek: d.getUTCDay() + 1,
    });
}

export function S2Date(year: number, month: number, day: number, dayofweek?: number): S2Object {
    return s2("Date", { year, month, day, ...(dayofweek !== undefined ? { dayofweek } : {}) });
}

// LJ::Tags::tag_url
export function tagUrl(base: string, name: string): string {
    const escaped = eurl(name);
    return base + (/[\/\\]|%2B/.test(escaped) ? "?tag=" : "/tag/") + escaped;
}

export function Tag(base: string, kwid: number, name: string): S2Object {
    return s2("Tag", { $id: kwid, name: ehtml(name), url: tagUrl(base, name) });
}

export function UserLite(site: Site, u: User): S2Object {
    return s2("UserLite", {
        $userid: u.userid,
        user: ehtml(u.user),
        username: ehtml(u.user),
        name: ehtml(u.name),
        journal_type: u.journaltype,
        userpic_listing_url: `${u.journalBase(site)}/icons`,
        link_keyseq: ["manage_membership", "trust", "watch", "post_entry", "track", "message", "tell_friend"],
    });
}

export function UserObject(site: Site, u: User, defaultPic: S2Object): S2Object {
    return {
        ...UserLite(site, u), ".type": "User",
        _default_pic: defaultPic,
        _website_url: ehtml(u.props.url),
        _website_name: ehtml(u.props.urlname),
    };
}

export function ItemRange(fields: Record<string, unknown>, urlOf: (n: number) => string): S2Object {
    const range = s2("ItemRange", { ...fields, $url_of: urlOf });
    const current = Number(fields.current), total = Number(fields.total);
    if (current < total) range._url_next = urlOf(current + 1);
    if (current > 1) range._url_prev = urlOf(current - 1);
    if (current !== 1) range._url_first = urlOf(1);
    if (current !== total) range._url_last = urlOf(total);
    return range;
}

// LJ::viewing_style_opts: the arguments that choose how a page is styled.
export function styleOpts(args: Readonly<Record<string, string>>): [string, string][] {
    const valid: Record<string, string[]> = {
        style: ["light", "site", "mine", "original"], format: ["light"], fallback: ["s2", "bml"],
    };
    const opts: [string, string][] = /^\d+$/.test(args.s2id ?? "") && args.s2id !== "0" ? [["s2id", args.s2id!]] : [];
    for (const [key, values] of Object.entries(valid)) {
        if (values.includes(args[key] ?? "")) opts.push([key, args[key]!]);
    }
    return opts;
}

// LJ::viewing_style_args
export function styleArgs(args: Readonly<Record<string, string>>): string {
    return styleOpts(args).map(([key, value]) => `${key}=${value}`).join("&");
}

// LJ::create_url with viewing_style: `extra` and the viewing style arguments, sorted.
export function styleUrl(args: Readonly<Record<string, string>>, url: string,
    extra: Readonly<Record<string, string | number>> = {}): string {
    const all: Record<string, string | number> = { ...Object.fromEntries(styleOpts(args)), ...extra };
    const query = Object.keys(all).sort().map(key => `${eurl(key)}=${eurl(String(all[key]))}`).join("&");
    return query ? `${url}?${query}` : url;
}

// LJ::Talk::talkargs
export function talkargs(url: string, ...args: string[]): string {
    const query = args.filter(Boolean).join("&");
    return query ? url + (url.includes("?") ? "&" : "?") + query : url;
}
