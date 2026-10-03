// text.ts
//
// Escaping helpers from LJ::TextUtil.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

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

// LJ::canonical_username
export function canonicalUsername(user: string): string {
    const name = user.trim().toLowerCase().replaceAll("-", "_");
    return /^\w{1,25}$/.test(name) ? name : "";
}
