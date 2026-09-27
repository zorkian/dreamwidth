// markdown.ts
//
// Bounded CommonMark conversion in the credential-free content worker.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import {createHash} from "node:crypto";
import type MarkdownItType from "markdown-it" with {"resolution-mode": "import"};
import {UnsupportedContent} from "./policy/errors";

const options = Object.freeze({html: true, xhtmlOut: true, breaks: false,
    linkify: false, typographer: false, maxNesting: 20});
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
// The pinned CommonJS declaration forwards to ESM without resolution-mode
// attributes. Use its maintained ESM types and the same root CommonJS export.
const MarkdownIt: typeof MarkdownItType = require("markdown-it");
const marker = /^[\t\n\v\f\r ]*!markdown[\t\n\v\f\r ]*\r?\n/i;
export const hasMagicMarkdown = (source: string): boolean => marker.test(source);
export const stripMagicMarkdown = (source: string): string => source.replace(marker, "");

export interface MarkdownConversion {
    readonly html: string;
    readonly sourceSha256: string;
    readonly htmlSha256: string;
    readonly converter: "markdown-it@15.0.2";
    readonly optionsSha256: string;
    readonly tokenCount: number;
}

export function convertMarkdown(source: string, maxBytes: number, maxTokens = 4096,
    maxDepth = 16): MarkdownConversion {
    if (Buffer.byteLength(source) > maxBytes) throw new UnsupportedContent();
    // Each call owns its parser and rules. Nothing changes shared prototypes or
    // another cleaner's parser; maintained rules remain the matching authority.
    const parser = new MarkdownIt("commonmark", options).disable("fence");
    const block = parser.block.tokenize;
    parser.block.tokenize = function (state, start, end): void {
        if (state.level > maxDepth) throw new UnsupportedContent();
        return block.call(this, state, start, end);
    };
    const inline = parser.inline.tokenize;
    parser.inline.tokenize = function (state): void {
        if (state.level > maxDepth) throw new UnsupportedContent();
        return inline.call(this, state);
    };
    const skip = parser.inline.skipToken;
    parser.inline.skipToken = function (state): void {
        if (state.level > maxDepth) throw new UnsupportedContent();
        return skip.call(this, state);
    };
    // The pinned package exposes rules through Ruler.getRules. Its maintained
    // backticks rule is named backtick; require exactly that function identity.
    const rules = parser.inline.ruler.getRules("").filter(rule => rule.name === "backtick");
    if (rules.length !== 1) throw new UnsupportedContent();
    const backticks = rules[0]!;
    parser.inline.ruler.at("backticks", function (this: unknown, state, silent): boolean {
        const start = state.pos;
        const previous = state.tokens.length;
        const matched = backticks.call(this, state, silent);
        if (matched && !silent) {
            for (const token of state.tokens.slice(previous)) {
                if (token.type !== "code_inline") continue;
                const span = state.src.slice(start, state.pos);
                // Only a span actually consumed into code by the original rule
                // is examined. Classic Markdown retains these code newlines;
                // CommonMark turns them into spaces, a visible incompatibility.
                if (/\n/.test(span)) throw new UnsupportedContent();
            }
        }
        return matched;
    });
    const environment = {};
    const tokens = parser.parse(source, environment);
    const pending = [...tokens];
    let count = 0;
    while (pending.length) {
        const token = pending.pop()!;
        if (++count > maxTokens || token.level > maxDepth) throw new UnsupportedContent();
        if (token.type === "ordered_list_open" && token.attrs)
            token.attrs = token.attrs.filter(([name]) => name !== "start");
        if (token.children) pending.push(...token.children);
    }
    const html = parser.renderer.render(tokens, parser.options, environment);
    if (Buffer.byteLength(html) > maxBytes) throw new UnsupportedContent();
    return Object.freeze({html, sourceSha256: digest(source), htmlSha256: digest(html),
        converter: "markdown-it@15.0.2", optionsSha256: digest(JSON.stringify(options)), tokenCount: count});
}
