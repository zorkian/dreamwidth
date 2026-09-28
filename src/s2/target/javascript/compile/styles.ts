// styles.ts
//
// Find the layers a journal's style is made of, as LJ::S2::get_style and
// LJ::S2::s2_context do.
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
import { type Databases, int, text } from "../data/db";
import type { User } from "../data/user";

export const LAYER_ORDER = ["core", "i18nc", "layout", "i18n", "theme", "user"] as const;

export interface LayerRef {
    readonly id: number;
    readonly type: string;
    readonly parentId: number;
    readonly ownerId: number;
    readonly sourceHash: string;
}

// Layers in run order. `user` must have its s2_style prop loaded.
export async function styleLayers(db: Databases, config: SiteConfig, user: User): Promise<LayerRef[]> {
    const styleid = int(user.props.s2_style);
    if (styleid) {
        const rows = await user.cluster(db, "SELECT type, s2lid FROM s2stylelayers2 WHERE userid = ? AND styleid = ?",
            [user.userid, styleid]);
        const layers = await loadLayers(db, rows.map(row => int(row.s2lid)).filter(Boolean));
        // A style whose core or layout was deleted falls back to the default.
        if (layers.some(layer => layer.type === "core") && layers.some(layer => layer.type === "layout")) return layers;
    }
    return defaultLayers(db, config);
}

async function defaultLayers(db: Databases, config: SiteConfig): Promise<LayerRef[]> {
    const names = Object.values(config.defaultStyle).filter(Boolean);
    const rows = await db.global(
        `SELECT i.s2lid FROM s2info i JOIN s2layers l ON l.s2lid = i.s2lid
         JOIN user u ON u.userid = l.userid AND u.user = 'system'
         WHERE i.infokey = 'redist_uniq' AND i.value IN (?)`, [names]);
    return loadLayers(db, rows.map(row => int(row.s2lid)));
}

async function loadLayers(db: Databases, ids: readonly number[]): Promise<LayerRef[]> {
    if (!ids.length) return [];
    const rows = await db.global(
        `SELECT l.s2lid, l.type, l.b2lid, l.userid, MD5(s.s2code) AS hash
         FROM s2layers l JOIN s2source_inno s ON s.s2lid = l.s2lid WHERE l.s2lid IN (?)`, [ids]);
    const layers = rows.map(row => ({
        id: int(row.s2lid), type: text(row.type), parentId: int(row.b2lid),
        ownerId: int(row.userid), sourceHash: text(row.hash),
    }));
    return LAYER_ORDER.flatMap(type => layers.filter(layer => layer.type === type).slice(0, 1));
}

export interface StyleInfo {
    readonly styleid: number;
    // The newest of the style and its compiled layers, for stylesheet URLs.
    readonly modtime: number;
    readonly layoutName?: string;
    readonly themeName?: string;
    readonly layoutUrl: string;
}

// What LJ::S2::Page reports about the style.
export async function styleInfo(db: Databases, config: SiteConfig, user: User,
    layers: readonly LayerRef[]): Promise<StyleInfo> {
    const styleid = int(user.props.s2_style);
    const ids = layers.map(layer => layer.id);
    const [styles, compiled, userCompiled, names] = await Promise.all([
        styleid ? db.global("SELECT modtime FROM s2styles WHERE styleid = ?", [styleid]) : [],
        db.global("SELECT MAX(comptime) AS t FROM s2compiled WHERE s2lid IN (?)", [ids]),
        user.cluster(db, "SELECT MAX(comptime) AS t FROM s2compiled2 WHERE userid = ? AND s2lid IN (?)", [user.userid, ids]),
        db.global("SELECT s2lid, value FROM s2info WHERE infokey = 'name' AND s2lid IN (?)", [ids]),
    ]);
    const modtime = Math.max(int(styles[0]?.modtime), int(compiled[0]?.t), int(userCompiled[0]?.t));
    if (!styleid) return { styleid, modtime, layoutUrl: "" };

    const name = new Map(names.map(row => [int(row.s2lid), text(row.value)]));
    const layout = layers.find(layer => layer.type === "layout");
    const theme = layers.find(layer => layer.type === "theme");
    const layoutName = layout ? name.get(layout.id) ?? "" : "";
    if (!theme) {
        return { styleid, modtime, layoutName, themeName: config.strings["s2theme.themename.notheme"] ?? "", layoutUrl: "" };
    }
    const system = layout && layers.find(layer => layer.type === "core")?.ownerId === layout.ownerId;
    return {
        styleid, modtime, layoutName,
        themeName: name.get(theme.id) || (config.strings["s2theme.themename.default"] ?? "").replace("[[themeid]]", `#${theme.id}`),
        layoutUrl: system ? `${config.siteRoot}/customize/?layoutid=${layout!.id}` : "",
    };
}
