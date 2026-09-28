// markdown.ts
//
// Convert Markdown to HTML for the markdown0 format.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import MarkdownIt from "markdown-it";

// Raw HTML passes through; the cleaner handles it afterwards.
const parser = new MarkdownIt({ html: true, xhtmlOut: true, breaks: false, linkify: false, typographer: false });

// Text::Markdown leaves \@ alone, so the user mention pass can treat it as an
// escaped @ rather than a mention.
const escape = parser.inline.ruler.getRules("").find(rule => rule.name === "escape")!;
parser.inline.ruler.at("escape", (state, silent) =>
    state.src.startsWith("\\@", state.pos) ? false : escape(state, silent));

export function markdown(text: string): string {
    return parser.render(text);
}
