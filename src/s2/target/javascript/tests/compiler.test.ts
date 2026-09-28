// compiler.test.ts
//
// The S2 compiler's test programs in src/s2/tests, compiled to JavaScript and
// run, give their expected output or error.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { Compiler } from "../compile/compiler";
import { colorBuiltins } from "../render/builtins";
import { instantiate } from "../render/context";
import { Context, runtime } from "../runtime/s2runtime";

const TESTS = path.resolve(__dirname, "../../../../tests");
const compiler = new Compiler();
after(() => compiler.close());

// The builtins runtests.pl gives the test programs.
const builtins = {
    ...colorBuiltins(),
    _BracketWrapper__as_string: (_ctx: Context, self: Record<string, unknown>) =>
        runtime.isDefined(self) ? `[${self._text}]` : undefined,
    _BracketWrapper2__toString: (_ctx: Context, self: Record<string, unknown>) =>
        runtime.isDefined(self) ? `[${self._text}]` : undefined,
};

const read = (file: string) => existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;

for (const file of readdirSync(TESTS).filter(name => name.endsWith(".s2")).sort()) {
    test(file, async () => {
        const source = readFileSync(path.join(TESTS, file), "utf8");
        const expected = read(path.join(TESTS, `${file}.out`));
        const expectedError = read(path.join(TESTS, `${file}.err`));
        let output = "";
        let error = "";
        try {
            const code = await compiler.compileSource({
                key: file, type: "core", untrusted: false, variable: "layer_1", source,
            });
            const layers = instantiate([{ id: 1, type: "core", variable: "layer_1", code }]);
            new Context(layers, text => { output += text; }, {}, builtins).runFunction("main()");
        } catch (e) {
            error = (e as Error).message;
        }
        if (expectedError !== undefined) assert.ok(error.includes(expectedError), `expected error ${expectedError}, got ${error}`);
        else assert.equal(error, "");
        assert.equal(output.trim(), expected ?? "");
    });
}
