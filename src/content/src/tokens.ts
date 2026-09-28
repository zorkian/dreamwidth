// tokens.ts
//
// Split HTML into the tokens HTML::TokeParser returns, for the cleaners
// ported from Perl.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { decodeHTML } from "entities";
import { Tokenizer } from "htmlparser2";

export type Token =
    // Start tag: lowercased name, decoded attribute values, names in order,
    // whether it closed itself (<br />), and its original text.
    | { type: "S"; tag: string; attrs: Record<string, string>; order: string[]; selfClosing: boolean; text: string }
    | { type: "E"; tag: string; text: string }
    // Text, with entities left as written.
    | { type: "T"; text: string }
    | { type: "C"; text: string }
    | { type: "D"; text: string }
    | { type: "PI"; text: string };

export function tokenize(html: string): Token[] {
    const tokens: Token[] = [];
    let tag = "";
    let tagStart = 0;
    let attrs: Record<string, string> = {};
    let order: string[] = [];
    let name = "";
    let value = "";
    let hasValue = false;

    const text = (value: string) => {
        const last = tokens.at(-1);
        if (last?.type === "T") last.text += value;
        else tokens.push({ type: "T", text: value });
    };
    const open = (selfClosing: boolean, end: number) => {
        tokens.push({ type: "S", tag, attrs, order, selfClosing, text: html.slice(tagStart, end + 1) });
    };

    const tokenizer = new Tokenizer({ decodeEntities: false }, {
        onopentagname(start, end) {
            tagStart = start - 1;
            tag = html.slice(start, end).toLowerCase();
            attrs = {};
            order = [];
        },
        onattribname(start, end) {
            name = html.slice(start, end).toLowerCase();
            value = "";
            hasValue = false;
        },
        onattribdata(start, end) {
            value += html.slice(start, end);
            hasValue = true;
        },
        onattribentity(codepoint) {
            value += String.fromCodePoint(codepoint);
            hasValue = true;
        },
        onattribend() {
            // HTML::Parser keeps the first of repeated attributes, and gives
            // a bare attribute its own name as its value.
            if (name in attrs) return;
            attrs[name] = hasValue ? decodeHTML(value) : name;
            order.push(name);
        },
        onopentagend(end) { open(false, end); },
        onselfclosingtag(end) { open(true, end); },
        onclosetag(start, end) {
            const closing = html.slice(start, end).toLowerCase();
            tokens.push({ type: "E", tag: closing, text: `</${closing}>` });
        },
        ontext(start, end) { text(html.slice(start, end)); },
        ontextentity() {},
        oncomment(start, end, offset) {
            tokens.push({ type: "C", text: html.slice(start - 4, end + offset) });
        },
        oncdata(start, end, offset) {
            tokens.push({ type: "C", text: html.slice(start - 9, end + offset) });
        },
        ondeclaration(start, end) {
            tokens.push({ type: "D", text: html.slice(start - 2, end + 1) });
        },
        onprocessinginstruction(start, end) {
            tokens.push({ type: "PI", text: html.slice(start, end) });
        },
        onend() {},
    });
    tokenizer.write(html);
    tokenizer.end();
    return tokens;
}

// A cursor over tokens with the HTML::TokeParser operations the cleaners use.
export class TokenStream {
    private index = 0;

    constructor(private readonly tokens: Token[]) {}

    next(): Token | undefined {
        return this.tokens[this.index++];
    }

    unget(): void {
        this.index--;
    }

    // get_tag("/name"): skip to just past the next end tag with this name.
    skipPast(tag: string): Token | undefined {
        for (let token = this.next(); token; token = this.next()) {
            if (token.type === "E" && token.tag === tag) return token;
        }
        return undefined;
    }

    // get_text("/name"): text up to (not including) the named end tag, or
    // up to the next tag of any kind when no name is given.
    textUntil(tag?: string): string {
        let result = "";
        for (let token = this.next(); token; token = this.next()) {
            if (token.type === "T") {
                result += decodeHTML(token.text);
                continue;
            }
            if (tag === undefined || (token.type === "E" && token.tag === tag)) {
                this.unget();
                break;
            }
        }
        return result;
    }
}
