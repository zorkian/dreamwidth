// context.ts
//
// Create an S2 context from compiled layers and initialize it, as
// LJ::S2::s2_context does.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { Context, Layer, s2 as runtime, type BuiltinFunction } from "../runtime/s2runtime";
import type { CompiledLayer } from "../compile/compiler";
import type { SiteConfig } from "../server/config";

// Cleaners for property values, by their string_mode.
export interface PropertyCleaners {
    html(value: string): string;
    simpleHtml(value: string): string;
    css(value: string): string;
    cssAttribute(value: string): string;
}

// Where printed text goes. Safe prints pass through the HTML cleaner.
export interface Output {
    raw(text: string): void;
    safe(text: string): void;
}

export interface S2Context {
    readonly ctx: Context;
    readonly layers: readonly Layer[];
    // Printing is suppressed until the page itself runs.
    printing: boolean;
}

export function instantiate(compiled: readonly CompiledLayer[]): Layer[] {
    return compiled.map(layer => {
        const instance = new Function("s2", `"use strict";\n${layer.code}\nreturn ${layer.variable};`)(runtime) as Layer;
        instance.source = `${layer.type} layer ${layer.id}`;
        return instance;
    });
}

export function createContext(compiled: readonly CompiledLayer[], config: SiteConfig,
    builtins: Record<string, BuiltinFunction>, output: Output, cleaners: PropertyCleaners): S2Context {
    const layers = instantiate(compiled);
    const state = { printing: false };
    const ctx = new Context(layers,
        text => { if (state.printing && text !== "") output.raw(text); },
        {
            // LJ::S2::populate_system_props
            SITEROOT: config.siteRoot, PALIMGROOT: config.palImgRoot, SITENAME: config.siteName,
            SITENAMESHORT: config.siteNameShort, SITENAMEABBREV: config.siteNameAbbrev,
            IMGDIR: config.imgPrefix, STYLES_IMGDIR: config.imgPrefix + "/styles", STATDIR: config.statPrefix,
        },
        builtins,
        text => { if (state.printing) output.safe(text); return ""; });
    const props = ctx.prop as Record<string, any>;

    // LJ::S2::alias_renamed_props
    if ("_page_recent_items" in props) props._num_items_recent = props._page_recent_items;
    if ("_page_friends_items" in props) props._num_items_reading = props._page_friends_items;
    if ("_page_day_sortorder" in props) props._reverse_sortorder_day = props._page_day_sortorder === "reverse" ? 1 : 0;
    if ("_page_year_sortorder" in props) props._reverse_sortorder_year = props._page_year_sortorder === "reverse" ? 1 : 0;
    if ("_view_entry_disabled" in props) {
        props._use_journalstyle_entry_page = props._view_entry_disabled ? 0 : 1;
        props._use_journalstyle_icons_page = 0;
    }

    // LJ::S2::alias_overriding_props
    for (const [original, overriding] of Object.entries(props._grouped_property_override ?? {})) {
        if (props[`_${overriding}`]) props[`_${original}`] = props[`_${overriding}`];
    }

    // Perl autovivifies the section arrays modules_init pushes onto.
    props._module_sections = autovivify(props._module_sections ?? {});

    // Errors in either are ignored, as the Perl evals ignore them.
    for (const name of ["prop_init()", "modules_init()"]) {
        try {
            ctx.runFunction(name);
        } catch {
            // continue with whatever was initialized
        }
    }
    // Unset positions in the section arrays read as empty rows in Perl.
    for (const section of Object.values(props._module_sections as Record<string, unknown[]>)) {
        if (Array.isArray(section)) for (let i = 0; i < section.length; i++) section[i] ??= [];
    }
    escapeAllProps(ctx, layers, cleaners);
    return {
        ctx, layers,
        get printing() { return state.printing; },
        set printing(value) { state.printing = value; },
    };
}

function autovivify(sections: Record<string, unknown>): Record<string, unknown> {
    return new Proxy(sections, {
        get(target, key) {
            if (typeof key === "string" && !(key in target)) target[key] = [];
            return target[key as string];
        },
    });
}

// LJ::S2::escape_all_props
function escapeAllProps(ctx: Context, layers: readonly Layer[], cleaners: PropertyCleaners): void {
    const props = ctx.prop as Record<string, unknown>;
    for (const layer of layers) {
        for (const [name, declaration] of layer.declarations) {
            if (!props[name]) continue;
            props[name] = escapeValue(props[name], declaration.attributes.string_mode || "plain", cleaners);
        }
    }
}

// LJ::S2::escape_prop_value
export function escapeValue(value: unknown, mode: string, cleaners: PropertyCleaners): unknown {
    if (Array.isArray(value)) return value.map(item => escapeValue(item, mode, cleaners));
    if (value && typeof value === "object") {
        // Objects such as Colors are not strings to escape.
        if (".type" in value) return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeValue(item, mode, cleaners)]));
    }
    if (typeof value !== "string" && typeof value !== "number") return value;
    const text = String(value);
    switch (mode) {
        case "simple-html": return cleaners.simpleHtml(text).replaceAll("\n", "<br />");
        case "simple-html-oneline": return cleaners.simpleHtml(text);
        case "html": return cleaners.html(text).replaceAll("\n", "<br />");
        case "html-oneline": return cleaners.html(text);
        case "css": return cleaners.css(text);
        case "css-attrib":
            if (/[{}]/.test(text)) return "/* bad CSS: can't use braces in a style attribute */";
            return cleaners.cssAttribute(text);
        default:
            if (typeof value === "number") return value;
            return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br />");
    }
}
