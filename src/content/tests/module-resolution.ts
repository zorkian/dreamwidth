// module-resolution.ts
//
// Type-check the pinned DOM and CSS package declaration closure without skips.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import * as cssTree from "css-tree";

export function makeDeclarationProbe(): string {
    const window = new JSDOM("<p>ok</p>").window;
    const clean = createDOMPurify(window).sanitize("<p>ok</p>");
    window.close();
    return cssTree.generate(cssTree.parse("color:red", { context: "declarationList" })) + clean;
}
