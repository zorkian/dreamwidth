// stage-general.mjs
//
// Install the closed general S2 worker independently of stock catalog artifacts.
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

import fs from 'node:fs';
import path from 'node:path';
import {stageGeneralRuntime} from '../../../../content/tools/stage-runtime.mjs';

try {
    if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) {
        throw new Error('usage: node tools/stage-general.mjs <absolute-installation.json>');
    }
    const filename = process.argv[2];
    const descriptor = Buffer.from(JSON.stringify({schema: 1, kind: 'general-s2-worker',
        entry: 'app/dist/live/render/general-worker.js'}) + '\n');
    try {fs.writeFileSync(filename, descriptor, {flag: 'wx', mode: 0o444});}
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = fs.lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== descriptor.length ||
            !fs.readFileSync(filename).equals(descriptor)) {
            throw new Error('existing installation descriptor differs');
        }
    }
    stageGeneralRuntime(filename);
} catch (error) {
    console.error(error instanceof Error ? error.message : 'General runtime setup failed');
    process.exitCode = 1;
}
