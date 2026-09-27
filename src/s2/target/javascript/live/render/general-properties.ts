// general-properties.ts
//
// Declared native property initialization and recursive scalar escaping.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//
// Semantic ports from LJ/S2.pm, originally forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and subsequently modified by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. A copy of that license is
// included in the LICENSE file in this distribution.
//

import {escapeGeneralPlainProperty} from "@dreamwidth/content/general-contexts";
import {Context, Layer, runtime} from "../../runtime/s2runtime";
import {NativeNumber, NativeString, scalarPV, scalarTruthy, legacyText} from "../../runtime/native-scalar";
import type {PublicAppConfig} from "../contracts";

export interface PropertyCleanResult {
    readonly value: NativeString;
    // Actual reached native element-cleaner eval, not merely successful parsing.
    readonly clearsException: boolean;
}
export interface GeneralPropertyCleaner {
    clean(mode: "simple-html" | "simple-html-oneline" | "html" | "html-oneline" |
        "css" | "css-attrib", value: NativeString): PropertyCleanResult;
}
const name = (key: string): string => key.startsWith("_") ? key : "_" + key;

export function initializeGeneralProperties(ctx: Context, config: PublicAppConfig): void {
    const systems = {SITEROOT: config.siteRoot, PALIMGROOT: config.palImgRoot,
        SITENAME: config.siteName, SITENAMESHORT: config.siteNameShort,
        SITENAMEABBREV: config.siteNameAbbrev, IMGDIR: config.imgPrefix,
        STYLES_IMGDIR: config.imgPrefix + "/styles", STATDIR: config.statPrefix};
    for (const [key, value] of Object.entries(systems)) ctx.prop[name(key)] = NativeString.hostUtf8Bytes(value);
    for (const [old, current] of [["page_recent_items", "num_items_recent"],
        ["page_friends_items", "num_items_reading"]] as const) {
        if (Object.hasOwn(ctx.prop, name(old))) ctx.prop[name(current)] = ctx.prop[name(old)];
    }
    for (const [old, current] of [["page_day_sortorder", "reverse_sortorder_day"],
        ["page_year_sortorder", "reverse_sortorder_year"]] as const) {
        if (Object.hasOwn(ctx.prop, name(old))) {
            ctx.prop[name(current)] = NativeNumber.integer(
                scalarPV(ctx.prop[name(old)]).bytes().equals(Buffer.from("reverse")) ? 1n : 0n);
        }
    }
    if (Object.hasOwn(ctx.prop, "_view_entry_disabled")) {
        ctx.prop._use_journalstyle_entry_page = NativeNumber.integer(scalarTruthy(ctx.prop._view_entry_disabled) ? 0n : 1n);
        ctx.prop._use_journalstyle_icons_page = NativeNumber.integer(0n);
    }
    const overrides = ctx.prop._grouped_property_override;
    if (scalarTruthy(overrides)) for (const original of runtime.hashKeys(overrides)) {
        const target = runtime.memberSlot(overrides, original, "hash").get();
        const key = name(legacyText(scalarPV(target)));
        if (scalarTruthy(ctx.prop[key])) ctx.prop[name(legacyText(scalarPV(original)))] = ctx.prop[key];
    }
}

/** Mutate the original arrays/hashes, retaining alias identity as native does. */
export function escapeGeneralProperties(ctx: Context, layers: readonly Layer[], cleaner: GeneralPropertyCleaner,
    clearException: () => void, maxNodes = 100000): void {
    let nodes = 0;
    for (const layer of layers) for (const [declared, metadata] of layer.declarations) {
        const key = name(declared);
        if (!scalarTruthy(ctx.prop[key])) continue;
        const mode = metadata.attributes.string_mode || "plain";
        const work: {container: Record<string, unknown> | unknown[]; key: string; depth: number}[] =
            [{container: ctx.prop, key, depth: 0}];
        while (work.length) {
            const slot = work.pop()!;
            if (++nodes > maxNodes || slot.depth > 1000) throw new Error("Property traversal resource bound");
            const container = slot.container as Record<string, unknown>, value = container[slot.key];
            if (value === null || value === undefined) continue;
            if (typeof value === "object" && !NativeString.is(value) && !NativeNumber.is(value)) {
                const prototype = Object.getPrototypeOf(value);
                if (Array.isArray(value) || prototype === null || prototype === Object.prototype) {
                    for (const child of Object.keys(value).reverse()) {
                        // These two fields encode native object type/null state in
                        // the JS ABI. They are not native scalar hash members.
                        if (Object.hasOwn(value, ".type") && (child === ".type" || child === ".isnull")) continue;
                        work.push({container: value as Record<string, unknown>, key: child, depth: slot.depth + 1});
                    }
                } else container[slot.key] = undefined;
                continue;
            }
            const pv = scalarPV(value);
            if (["simple-html", "simple-html-oneline", "html", "html-oneline", "css", "css-attrib"].includes(mode)) {
                const result = cleaner.clean(mode as Parameters<GeneralPropertyCleaner["clean"]>[0], pv);
                container[slot.key] = result.value;
                if (result.clearsException) clearException();
            } else {
                container[slot.key] = NativeString.fromFrame(escapeGeneralPlainProperty(pv.frame()));
            }
        }
    }
}
