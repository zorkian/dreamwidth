// native-output.ts
//
// Byte-preserving Context sink for one native page-output session.
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

import {createPageOutput} from '@dreamwidth/content/page-output';
import {NativeOutput, NativeString, type NativePVFrame} from '../../runtime/native-string';
import {isNativeExecutionStop} from '../../runtime/native-scalar';
import {type NativeSink} from '../../runtime/native-scalar';

export type NativeOutputOptions = Omit<Parameters<typeof createPageOutput>[0], 'output'>;

/** Only the trusted coordinator receives this object, never stored S2 code. */
export interface NativePageOutput {
    readonly sink: NativeSink;
    startCss(): void;
    endCss(): void;
    finish(): NativePVFrame;
    // Caller distinguishes a program exception from cleaner/infrastructure errors.
    runtimeError(diagnostic: NativeString): NativePVFrame;
    abort(): void;
}

export function createNativeOutput(options: NativeOutputOptions): NativePageOutput {
    const output = new NativeOutput();
    let state: 'open' | 'complete' | 'failed' = 'open';
    const page = createPageOutput({...options, output: chunk => output.append(NativeString.fromFrame(chunk))});
    function operate<T>(operation: () => T): T {
        if (state !== 'open') throw new Error('Native page output is terminal');
        try { return operation(); }
        catch (error) {
            if (!isNativeExecutionStop(error)) state = 'failed';
            throw error;
        }
    }
    const sink: NativeSink = Object.freeze({
        ownsPrintCheckpoints: true as const,
        raw: (value: NativeString) => operate(() => page.printRaw(value.frame())),
        safe: (value: NativeString) => operate(() => page.printSafe(value.frame())),
    });
    function complete(operation: () => void): NativePVFrame {
        return operate(() => {
            operation();
            const frame = output.frame();
            state = 'complete';
            return frame;
        });
    }
    return Object.freeze({
        sink,
        startCss: () => operate(() => page.startCss()),
        endCss: () => operate(() => page.endCss()),
        finish: () => complete(() => page.finish()),
        // LJ/S2.pm333-354: error completion deliberately omits cleaner eof.
        runtimeError: (diagnostic: NativeString) => complete(() => {
            if (options.contentType === 'text/css') page.endCss();
            page.printRaw(diagnostic.frame());
        }),
        abort: () => { state = 'failed'; },
    });
}
