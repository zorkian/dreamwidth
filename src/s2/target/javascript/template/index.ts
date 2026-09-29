// index.ts
//
// Render Template Toolkit templates through a Template object, as
// DW::Template's engines do.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { Context, Control, type Options, type Stash } from "./runtime";

export { TemplateError } from "./parser";
export { type Filter, type Options, type Plugin, type Stash, type Value, Context, num, str, truthy } from "./runtime";

export class Template {
    // `preProcess` names templates run before each one, as PRE_PROCESS does.
    constructor(private readonly options: Options & { readonly preProcess?: readonly string[] }) {}

    process(name: string, vars: Stash = {}): string {
        const context = new Context(this.options, { ...vars });
        let out = "";
        try {
            for (const pre of this.options.preProcess ?? []) out += context.process(pre);
            return out + context.process(name);
        } catch (error) {
            if (error instanceof Control && error.kind === "stop") return out + error.output;
            throw error;
        }
    }
}
