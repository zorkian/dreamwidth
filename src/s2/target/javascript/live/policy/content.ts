// content.ts
//
// Bounded local S2 journal policy and rendering support.
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

export class Unsupported extends Error {
    constructor() { super("Unsupported local journal state"); }
}

export function plainSubject(value: string): string {
    if (!value || Buffer.byteLength(value) > 1024 ||
        /[<>"'\x00-\x1f\x7f]|&(?:#\w+|[A-Za-z][A-Za-z0-9]+);/.test(value) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
        throw new Unsupported();
    }
    return value;
}

// Parent admission performs only UTF8/size checks. No DOM/CSS parser or safe
// fragment is loaded into the process holding repository and signing access.
export function rawBody(value: string): string {
    if (typeof value !== "string" || value.length > 65536 || Buffer.byteLength(value) > 65536 ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
        throw new Unsupported();
    }
    return value;
}

// Historical slice-3 identity-domain oracle, retained for its offline regression
// probes only. Serving admission uses rawBody; the isolated worker performs the
// actual entry cleaning. This function must not confer serving HTML authority.
export function bodyHtml(value: string): string {
    if (Buffer.byteLength(value) > 65536 || /[\x00-\x08\x0b-\x1f\x7f]/.test(value) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
        throw new Unsupported();
    }
    const stack: string[] = [];
    let tokens = 0;
    for (let pos = 0; pos < value.length;) {
        if (++tokens > 4096) throw new Unsupported();
        if (value[pos] === "<") {
            const match = /^<(\/?)(p|strong|em|b|i)>|^<br(?: \/)?>/.exec(value.slice(pos));
            if (!match) throw new Unsupported();
            const tag = match[2];
            if (tag) {
                if (match[1]) {
                    if (stack.pop() !== tag) throw new Unsupported();
                } else {
                    if ((tag === "p" && stack.length > 0) || stack.length >= 16) {
                        throw new Unsupported();
                    }
                    stack.push(tag);
                }
            }
            pos += match[0].length;
        } else {
            const end = value.indexOf("<", pos);
            const text = value.slice(pos, end < 0 ? value.length : end);
            if (/[>]|&(?!(?:amp|lt|gt|quot);)(?:#|[A-Za-z0-9]+;)/.test(text)) {
                throw new Unsupported();
            }
            pos += text.length;
        }
    }
    if (stack.length) throw new Unsupported();
    return value;
}
