// theme-catalog.ts
//
// Reviewed stock theme source and generated code identities.
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

export const THEMES = {
    "dazzle": {
        "title": "Dazzle",
        "authors": ["zvi"],
        "sourceHash": "ec3edd18ce181e1267de3aa46a8fb0266be8d9baf5c18498132a2ece3e739ce5",
        "codeHash": "11e9bcaf57295f82d00c545ff02cfeb8d30ccd3ccc0ae7cf3281ff762ea93126"
    },
    "kelis": {
        "title": "Kelis",
        "authors": ["zvi"],
        "sourceHash": "92802e7155edc5a32b8fc15bdcd75f3ed47a1e1f7ab4726567b4c2793827335a",
        "codeHash": "8404321f05ee95947b31748aac139f12103e531255f076c2bd86e769a856dc22"
    }
} as const;
export type ThemeName = keyof typeof THEMES;
