// images.ts
//
// Bounded image candidates and source-bound public proxy resolution records.
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

import type {CleanerLimits, EntryContentInput, ImageRequest, ImageResolutionSet} from "../contracts";
import {UnsupportedContent} from "./errors";
import {imageUrl} from "./urls";
import type {SourceLocation} from "./cuts";

export interface AttributeLocation extends SourceLocation {
    readonly attrs?: Readonly<Record<string, SourceLocation>>;
}

// This follows the whitespace-delimited URL token boundary: internal commas
// belong to the URL; trailing commas terminate candidates. Data URLs have
// already been denied by entry attribute policy. Ambiguous descriptors refuse.
export function parseSrcset(value: string): {url: string; descriptor: string}[] {
    const result: {url: string; descriptor: string}[] = [];
    let position = 0;
    while (position < value.length) {
        while (/[\t\n\f\r ,]/.test(value[position] ?? "") && position < value.length) position++;
        if (position === value.length) break;
        const start = position;
        while (position < value.length && !/[\t\n\f\r ]/.test(value[position]!)) position++;
        let url = value.slice(start, position);
        let descriptor = "";
        if (url.endsWith(",")) url = url.replace(/,+$/, "");
        else {
            const startDescriptor = position;
            while (position < value.length && value[position] !== ",") position++;
            descriptor = value.slice(startDescriptor, position).trim();
            if (descriptor && (!/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor) ||
                !Number.isFinite(Number.parseFloat(descriptor)) || Number.parseFloat(descriptor) <= 0)) {
                throw new UnsupportedContent();
            }
            if (value[position] === ",") position++;
        }
        if (!url) throw new UnsupportedContent();
        result.push({url, descriptor});
    }
    return result;
}

export class ImagePass {
    readonly requests: ImageRequest[] = [];
    private candidates = 0;
    private used = 0;
    constructor(private readonly input: EntryContentInput, private readonly hash: string,
        private readonly limits: CleanerLimits, private readonly locate: (node: Node) => AttributeLocation | null,
        private readonly resolutions?: ImageResolutionSet) {
        if (resolutions && (resolutions.inputSha256 !== hash || !Array.isArray(resolutions.images) ||
            resolutions.images.length > limits.maxImageCandidates)) throw new UnsupportedContent();
    }
    resolve(element: Element, attribute: "src" | "srcset", value: string): string {
        if (++this.candidates > this.limits.maxImageCandidates) throw new UnsupportedContent();
        const decision = imageUrl(value, this.input.context);
        if (decision.kind === "ready") return decision.url;
        const location = this.locate(element)?.attrs?.[attribute];
        if (!location) throw new UnsupportedContent();
        const raw = this.input.body.slice(location.startOffset, location.endOffset);
        const prefix = /^[^\s=/>]+\s*=\s*/.exec(raw)?.[0];
        if (!prefix) throw new UnsupportedContent();
        let start = location.startOffset + prefix.length;
        let end = location.endOffset;
        const quote = this.input.body[start];
        if (quote === '"' || quote === "'") {
            if (this.input.body[end - 1] !== quote) throw new UnsupportedContent();
            start++;
            end--;
        }
        const ordinal = this.requests.length;
        this.requests.push({ordinal, attribute, url: decision.url, sourceStart: start, sourceEnd: end,
            sourceText: this.input.body.slice(start, end)});
        if (!this.resolutions) return decision.url;
        const resolved = this.resolutions.images[ordinal];
        if (!resolved || resolved.ordinal !== ordinal || typeof resolved.url !== "string" ||
            resolved.url.length > 8192 || /[\x00-\x20\\]/.test(resolved.url)) throw new UnsupportedContent();
        const parsed = new URL(resolved.url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new UnsupportedContent();
        }
        this.used++;
        return resolved.url;
    }
    finish(): void {
        if (this.resolutions && this.used !== this.resolutions.images.length) throw new UnsupportedContent();
    }
}
