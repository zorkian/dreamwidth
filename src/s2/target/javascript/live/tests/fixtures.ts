// fixtures.ts
//
// Entry content settings shared by the cleaner tests.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

export const config = {
    entryContent: {
        imagePlaceholder: { src: "/img/imageplaceholder2.png", width: 35, height: 35, alt: "Image", title: "Image" },
        urls: { siteDomain: "", knownHttpsSites: [] as string[], formDomainBanned: [] as string[],
            imageProxy: "not-configured" as const },
    },
};
