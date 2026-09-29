// page-output.ts
//
// Collect what a page prints. What S2 prints as safe, output from untrusted
// layers and `print safe`, goes through HTMLCleaner as in LJ::S2::s2_run.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { htmlCleaner } from "@dreamwidth/content";
import type { SiteConfig } from "../server/config";
import type { Output } from "./context";

export class OutputLimitError extends Error {
    constructor() {
        super("Page output limit exceeded");
    }
}

// Collects printed text. Safe prints are buffered and cleaned together when
// raw output follows, so a tag split across safe prints is still seen whole.
export class PageOutput implements Output {
    private html = "";
    private pending = "";
    // start_css sends both kinds of output here, uncleaned, until end_css.
    private capture: string | undefined;

    // Only HTML pages are cleaned; stylesheets print safe output as it is.
    constructor(private readonly config: SiteConfig, private readonly maxBytes: number, private readonly clean = true) {}

    raw(text: string): void {
        if (this.capture !== undefined) {
            this.capture += text;
            return;
        }
        this.flush();
        this.append(text);
    }

    safe(text: string): void {
        if (this.capture !== undefined) {
            this.capture += text;
            return;
        }
        this.pending += text;
        if (this.pending.length > this.maxBytes) throw new OutputLimitError();
    }

    startCapture(): void {
        this.capture = "";
    }

    endCapture(): string {
        const captured = this.capture ?? "";
        this.capture = undefined;
        return captured;
    }

    finish(): string {
        this.flush();
        return this.html;
    }

    private flush(): void {
        if (!this.pending) return;
        const text = this.pending;
        this.pending = "";
        this.append(this.clean ? htmlCleaner(text, this.config) : text);
    }

    private append(text: string): void {
        this.html += text;
        if (this.html.length > this.maxBytes) throw new OutputLimitError();
    }
}
