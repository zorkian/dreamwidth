// site.ts
//
// Site settings and user lookups for the cleaner tests.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { CleanHooks, CleanSite } from "../index";

export const site: CleanSite = {
    domain: "dreamwidth.test", domainWeb: "www.dreamwidth.test", siteRoot: "https://www.dreamwidth.test",
    imgPrefix: "https://www.dreamwidth.test/img", statPrefix: "https://www.dreamwidth.test/stc",
    trustedCssHosts: [], cssProxy: null, cssCleaner: true, isDevServer: false,
    knownHttpsSites: [], formDomainBanned: [],
    placeholder: { src: "/imageplaceholder2.png", width: 35, height: 35, alt: "Image" },
    strings: {
        "cleanhtml.error.markup": "[Error: Irreparable invalid markup ('[[aopts]]') in entry. Owner must fix manually. Raw contents below.]",
        "cleanhtml.error.markup.extra": "[<strong>Error:</strong> Irreparable invalid markup ('[[aopts]]') in entry. Owner must fix manually. Raw contents below.]",
        "cleanhtml.error.template": "[Error: unknown template '[[aopts]]']",
        "cleanhtml.error.template.video": "[Error: video template not supported]",
        "cleanhtml.suspend_msg": "This entry has been suspended.",
    },
};

// The user tag LJ::ljuser gives a personal account named `name`.
export function userTag(name: string, noLink = false): string {
    const base = `https://${name.replaceAll("_", "-")}.dreamwidth.test`;
    const img = `<img src='https://www.dreamwidth.test/img/silk/identity/user.png' alt='[personal profile] ' ` +
        "width='17' height='17' style='vertical-align: text-bottom; border: 0; padding-right: 1px;' />";
    return noLink
        ? `<span lj:user='${name}' style='white-space: nowrap;' class='ljuser'>${img}<b>${name}</b></span>`
        : `<span lj:user='${name}' style='white-space: nowrap;' class='ljuser'><a href='${base}/profile'>${img}</a>` +
            `<a href='${base}/'><b>${name}</b></a></span>`;
}

// Accounts that exist on the test site.
export const hooks: CleanHooks = {
    user: (name, options) => ["system", "test_user"].includes(name)
        ? (options.textonly ? name : userTag(name, options.noLink)) : undefined,
};
