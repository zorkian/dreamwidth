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
        "layout": "tabula",
        "authors": ["zvi"],
        "sourceHash": "ec3edd18ce181e1267de3aa46a8fb0266be8d9baf5c18498132a2ece3e739ce5",
        "codeHash": "11e9bcaf57295f82d00c545ff02cfeb8d30ccd3ccc0ae7cf3281ff762ea93126"
    },
    "kelis": {
        "title": "Kelis",
        "layout": "tabula",
        "authors": ["zvi"],
        "sourceHash": "92802e7155edc5a32b8fc15bdcd75f3ed47a1e1f7ab4726567b4c2793827335a",
        "codeHash": "8404321f05ee95947b31748aac139f12103e531255f076c2bd86e769a856dc22"
    },
    "aqua": {
        "title": "Aqua", "layout": "easyread", "authors": ["krja"],
        "sourceHash": "6dc984c75c2302c933209aeca9689062b6c640cbeff9344c4cf1bcb0e585021a",
        "codeHash": "cb26fc5d189561f27dbf9150f409db8d00230e19f09ea95f984cce1d37ea8cbb"
    }
} as const;
export type ThemeName = keyof typeof THEMES;

export const EASYREAD = {title:"EasyRead", authors:["rb"],
    sourceHash:"de059e2869bcbee3a6ffb917bb09585ac054a325d48741c4ab1585df457adb92",
    codeHash:"e9cae02dbb717a85a9f1d636b8984a36878f53627fdf79953a7a8c1d061e8e1d"} as const;
