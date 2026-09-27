// page-css.ts
//
// Native generated-page CSS screening and stylesheet URL policy.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Semantic ports: cgi-bin/CSS/Cleaner.pm, LJ/CSS/Cleaner.pm and LJ/Web.pm.
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//

import type {StylesheetPolicy} from "./page-output-types";

// This is the retained screening transform, not a finite CSS grammar. Clean
// input remains byte-for-byte unchanged; comments/escapes affect screening only.
export function cleanPageCss(value: string, sheet: boolean): string {
    let reduced=sheet ? value.replaceAll("comment-bake-cookie","CLEANED") : value;
    const screenCharacter=(numeric: number): string=>{
        if(!Number.isFinite(numeric)||numeric>=2**63)throw new Error("Native CSS character outside signed UV range");
        // Extended native chr values are screening data only. None can match
        // the ASCII control/phrase rules; keep an inert non-whitespace marker.
        return numeric<=0x10ffff ? String.fromCodePoint(numeric) : "\uffff";
    };
    reduced=reduced.replace(/&#([0-9]+);?/g,(_,digits)=>screenCharacter(Number(digits)))
        .replace(/&#x(\w+);?/g,(_,digits)=>screenCharacter(parseInt(digits,16)||0));
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reduced))return "/* suspect CSS: low bytes */";
    const white=/[\x09-\x0d\x20\x85\xa0]+/g;
    const phrases=/(\bdata:\b|javascript|jscript|livescript|vbscript|expression|eval|cookie|\bwindow\b|\bparent\b|\bthis\b|behaviou?r|moz-binding)/i;
    const pass=(): string|null => {
        if(/<\w/.test(reduced))return "/* suspect CSS: start HTML tag? */";
        const withWhite=reduced;
        reduced=reduced.replace(white,"");
        if(/\\[a-f0-9]/i.test(reduced))return "/* suspect CSS: backslash hex */";
        reduced=reduced.replaceAll("\\","");
        const rule=/@(import|charset)([^\x0a\x0d]*)/i.exec(reduced);
        if(rule)return `/* suspect CSS: ${rule[1]} rule */`;
        if(/&#/.test(reduced))return "/* suspect CSS: found irregular &# */";
        if(/<\//.test(reduced))return "/* suspect CSS: close HTML tag */";
        let phrase=phrases.exec(reduced);
        if(phrase)return `/* suspect CSS: potential scripting: ${phrase[1]!.toLowerCase()} */`;
        reduced=withWhite.replace(/\/\*.*?\*\//sg,"").replace(/<!--.*?-->/sg,"")
            .replace(white,"").replaceAll("\\","");
        phrase=phrases.exec(reduced);
        return phrase ? `/* suspect CSS: potential scripting: ${phrase[1]!.toLowerCase()} */` : null;
    };
    let bad=pass();
    if(bad)return bad;
    reduced=reduced.replace(/\/\/[^\n]*/g,"");
    bad=pass();
    return bad ?? value;
}

export function stylesheetDestination(href: string, policy: StylesheetPolicy): string|false {
    const parts=/^https?:\/\/([^/]+?)(\/.*)$/.exec(href);
    if(!parts)return false;
    const host=parts[1]!, path=parts[2]!;
    const clean=(): string|false => !policy.cssCleanerEnabled ? href :
        policy.cssProxy && policy.cssProxy!=="0" ? policy.cssProxy+"?u="+href.replace(/[^a-zA-Z0-9_,.\-\/\\: ]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,"0")).replaceAll(" ","+") : false;
    if(Object.hasOwn(policy.trustedHosts,host) && policy.trustedHosts[host])return href;
    if(!host.toLowerCase().endsWith(policy.domain.toLowerCase()))return clean();
    if(host===policy.domain || host===policy.webDomain || href.startsWith(policy.statPrefix))return href;
    if(/^(\/\~\w+|\/users\/\w+|\/\w+)?\/res\/(\d+)\/stylesheet(\?\d+)?$/.test(path))return href;
    return clean();
}
