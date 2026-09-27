// active-style.ts
//
// Native active style selection, independently of source compilation or SQL.
//
// Portions adapted from LJ/S2.pm and LJ/User/Account.pm, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import type {LayerType} from '../render/layer-artifact';
import type {SourceStyleConfiguration} from '../startup-types';

export const ACTIVE_LAYER_ORDER: readonly LayerType[] =
    Object.freeze(['core', 'i18nc', 'layout', 'i18n', 'theme', 'user']);
export type ActiveLayerMap = Readonly<Record<string, number>>;
export interface PublicLayerDefinition {
    readonly id: number;
    readonly parentId: number;
    readonly info: Readonly<Record<string, string>>;
}
export interface ActiveProgramRequest {
    readonly username: string;
    readonly view: 'recent' | 'entry';
    // Parent-controlled selection. Entry may require another context after init.
    readonly selection: 'journal' | 'default' | 'siteviews' | 'sitefeeds';
}
export interface ActiveStyleSelection {
    readonly styleId: number;
    readonly origin: 'persisted' | 'default' | 'siteviews' | 'sitefeeds';
    readonly original: ActiveLayerMap;
    readonly effective: ActiveLayerMap;
    readonly unresolvedRoles: readonly string[];
}

const truth = (value: string | null | undefined): boolean => !!value && value !== '0';
// Native numeric user properties are not compiler-enforced UI values. Numeric
// prefix conversion is relevant here; nonnumeric values coerce to zero.
function nativeNumeric(value: string | null | undefined): number {
    if (!truth(value)) return 0;
    const match = /^[\t\n\r\f ]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(value!);
    return match ? Number(match[1]) : 0;
}
export function activeStyleId(settings: Readonly<Record<string, string | null>>): number {
    return nativeNumeric(settings.stylesys) === 2 ? nativeNumeric(settings.s2_style) : 0;
}

export function publicLayerAliases(rows: readonly PublicLayerDefinition[],
    config: SourceStyleConfiguration): ReadonlyMap<string, PublicLayerDefinition> {
    const byId = new Map(rows.map(row => [row.id, row]));
    const result = new Map<string, PublicLayerDefinition>();
    for (const row of rows) {
        const parentId = config.layerRemap[String(row.parentId)] || row.parentId;
        if (parentId && !byId.has(parentId)) continue;
        const alias = row.info.redist_uniq;
        if (alias) result.set(alias, {...row, parentId});
    }
    return result;
}

export function selectActiveStyle(styleId: number, map: ActiveLayerMap,
    publicLayers: ReadonlyMap<string, PublicLayerDefinition>, config: SourceStyleConfiguration,
    request: ActiveProgramRequest): ActiveStyleSelection {
    let original: Record<string, number> = {...map};
    let origin: ActiveStyleSelection['origin'] = 'persisted';
    const unresolvedRoles: string[] = [];
    if (request.selection === 'sitefeeds') {
        origin = 'sitefeeds'; original = {};
        for (const [role, alias] of Object.entries(config.defaultFeedStyle ?? {})) {
            const layer = publicLayers.get(alias);
            if (layer) original[role] = layer.id;
        }
        // sitefeeds_style skips unresolved aliases; an empty result reaches
        // s2_context's ordinary get_style(0) default branch.
        if (!Object.keys(original).length) {
            origin = 'default';
            for (const [role, alias] of Object.entries(config.defaultStyle)) {
                const layer = alias ? publicLayers.get(alias) : undefined;
                if (layer) original[role] = layer.id;
                else unresolvedRoles.push(role);
            }
        }
    } else if (request.selection === 'siteviews') {
        origin = 'siteviews';
        let theme = 'siteviews/default';
        for (const scheme of config.siteSchemeInheritance ?? []) {
            if (publicLayers.has('siteviews/' + scheme)) { theme = 'siteviews/' + scheme; break; }
        }
        original = {};
        for (const [role, alias] of Object.entries({core: 'core2', layout: 'siteviews/layout', theme})) {
            const layer = publicLayers.get(alias);
            if (layer) original[role] = layer.id;
            else unresolvedRoles.push(role);
        }
    } else if (request.selection === 'default' || !Object.keys(original).length) {
        origin = 'default'; original = {};
        for (const [role, alias] of Object.entries(config.defaultStyle)) {
            const layer = alias ? publicLayers.get(alias) : undefined;
            if (layer) original[role] = layer.id;
            else unresolvedRoles.push(role);
        }
    }
    const effective: Record<string, number> = {...original};
    // get_style remaps a persisted map once, before the default branch, and
    // deliberately excludes user. Never mutate native tables/status history.
    if (origin === 'persisted') for (const role of ['core', 'i18nc', 'i18n', 'layout', 'theme']) {
        const id = effective[role];
        if (id !== undefined && Object.hasOwn(config.layerRemap, String(id))) {
            effective[role] = config.layerRemap[String(id)]!;
        }
    }
    return Object.freeze({styleId: origin === 'persisted' ? styleId : 0, origin,
        original: Object.freeze(original), effective: Object.freeze(effective),
        unresolvedRoles: Object.freeze(unresolvedRoles)});
}
