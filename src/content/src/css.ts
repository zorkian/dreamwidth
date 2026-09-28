// css.ts
//
// Replace CSS that could run script with a comment, as CSS::Cleaner does.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

const SCRIPTING = /(\bdata:\b|javascript|jscript|livescript|vbscript|expression|eval|cookie|\bwindow\b|\bparent\b|\bthis\b|behaviou?r|moz-binding)/i;

// Returns the CSS unchanged, or a comment explaining why it was rejected.
export function cleanCss(css: string): string {
    let reduced = css.replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x(\w+);?/g, (whole, code) => {
            const point = parseInt(code, 16);
            return Number.isNaN(point) ? whole : String.fromCodePoint(point);
        });
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(reduced)) return "/* suspect CSS: low bytes */";

    const problem = (): string | undefined => {
        if (/<\w/.test(reduced)) return "/* suspect CSS: start HTML tag? */";
        const withWhite = reduced;
        reduced = reduced.replace(/[\s\x0b]+/g, "");
        if (/\\[a-f0-9]/i.test(reduced)) return "/* suspect CSS: backslash hex */";
        reduced = reduced.replaceAll("\\", "");
        const rule = /@(import|charset)/i.exec(reduced);
        if (rule) return `/* suspect CSS: ${rule[1]} rule */`;
        if (reduced.includes("&#")) return "/* suspect CSS: found irregular &# */";
        if (reduced.includes("</")) return "/* suspect CSS: close HTML tag */";
        const scripting = (text: string) => {
            const match = SCRIPTING.exec(text);
            return match ? `/* suspect CSS: potential scripting: ${match[1]!.toLowerCase()} */` : undefined;
        };
        const found = scripting(reduced);
        if (found) return found;
        reduced = withWhite.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "")
            .replace(/[\s\x0b]+/g, "").replaceAll("\\", "");
        return scripting(reduced);
    };

    const first = problem();
    if (first) return first;
    reduced = reduced.replace(/\/\/.*/g, "");
    return problem() ?? css;
}
