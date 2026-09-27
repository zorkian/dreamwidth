// active-program.test.ts
//
// Native selection and isolated SQL authority for general active S2 programs.
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {MysqlActivePrograms} from '../live/data/active-program';
import {SnapshotError} from '../live/data/errors';
import {selectActiveStyle, publicLayerAliases, activeStyleId} from '../live/domain/active-style';
import {withSelectedFixture} from './selected-fixture';

function native() {
    return JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=536870912', '--cpu=5', '--', '/usr/bin/perl',
        resolve('tools/active-style-native.pl')], {timeout: 10000, maxBuffer: 1048576}).toString()) as {
        layers: {id: number; type: string; parentId: number; sourceBase64: string; activeBase64: string}[];
        outputBase64: string; selection: {persisted: Record<string, number>; default: Record<string, number>; siteviews: Record<string, number>; incomplete: Record<string, number>};
        syntheticWrites: string[];
    };
}
test('actual native map/remap/default keeps user exclusion and compiled version authority', () => {
    const expected = native();
    assert.equal(Buffer.from(expected.outputBase64, 'base64').toString(), 'custom:userA');
    const config = {defaultStyle: {core: 'core2', layout: 'fixture/layout'},
        layerRemap: {'991010': 991020, '991013': 991023}};
    const aliases = publicLayerAliases([{id: 991010, parentId: 0, info: {redist_uniq: 'core2'}},
        {id: 991011, parentId: 991020, info: {redist_uniq: 'fixture/layout'}},
        {id: 991020, parentId: 0, info: {}}], config);
    const request = {username: 'ordinary6', view: 'recent', selection: 'journal'} as const;
    assert.deepEqual(selectActiveStyle(44, {core: 991010, layout: 991011, theme: 991012, user: 991013},
        aliases, config, request).effective, expected.selection.persisted);
    assert.deepEqual(selectActiveStyle(44, {}, aliases, config, request).effective, expected.selection.default);
    const siteAliases = new Map(aliases);
    siteAliases.set('siteviews/layout', {id: 991011, parentId: 991010, info: {}});
    siteAliases.set('siteviews/fixture_child', {id: 991012, parentId: 991011, info: {}});
    assert.deepEqual(selectActiveStyle(0, {}, siteAliases, {...config,
        siteSchemeInheritance: ['fixture_child', 'fixture_parent', 'global']},
        {...request, selection: 'siteviews'}).effective, expected.selection.siteviews);
    assert.deepEqual(selectActiveStyle(0, {}, aliases, {...config,
        defaultStyle: {core: 'missing/core', layout: 'missing/layout'}},
        {...request, selection: 'default'}).effective, expected.selection.incomplete);
    assert.deepEqual(expected.syntheticWrites, ['status', 'remap']);
    assert.equal(activeStyleId({stylesys: '2abc', s2_style: '44'}), 44);
});

test('actual primary owner groups, opaque binaries, absent source and complete reread', {
    skip: process.env.S2_SELECTED_FIXTURE !== '1',
}, async () => withSelectedFixture(async ({admin, g, c, other, table, startup, prop}) => {
    const expected = native();
    const config = {...startup, styles: {...startup.styles, siteSchemeInheritance: ['global']}};
    const repository = new MysqlActivePrograms(config);
    const request = {username: 'ordinary6', view: 'recent', selection: 'journal'} as const;
    try {
        const legacyConfig = new MysqlActivePrograms(startup);
        try {
            await assert.rejects(() => legacyConfig.load({...request, selection: 'siteviews'}), SnapshotError);
        } finally {await legacyConfig.close();}
        // Populate selected fixture system active bytes; ordinary records are read-only.
        await admin.query(`UPDATE ${table(g, 's2compiled')} f JOIN dw_global.s2compiled original
            ON original.s2lid=f.s2lid SET f.compdata=original.compdata`);
        await admin.query(`INSERT INTO ${table(g, 'user')} (userid,user,name,clusterid,status,statusvis,journaltype,dversion,caps)
            VALUES (900003,'zero_owner','Zero owner',0,'A','V','P',10,2)`);
        await admin.query(`INSERT INTO ${table(g, 'useridmap')} (userid,user) VALUES (900003,'zero_owner')`);
        await admin.query(`DELETE FROM ${table(c, 's2stylelayers2')} WHERE userid=900001 AND styleid=44`);
        for (const layer of expected.layers) {
            const ownerId = layer.type === 'layout' ? 900002 : layer.type === 'theme' ? 900003 : 900001;
            await admin.query(`INSERT INTO ${table(g, 's2layers')} (s2lid,userid,b2lid,type)
                VALUES (?,?,?,?)`, [layer.id, ownerId, layer.parentId, layer.type]);
            const source = Buffer.from(layer.sourceBase64, 'base64');
            await admin.query(`INSERT INTO ${table(g, 's2source_inno')} (s2lid,s2code) VALUES (?,?)`, [layer.id, source]);
            const active = Buffer.from(layer.activeBase64, 'base64');
            if (layer.type === 'theme') await admin.query(`INSERT INTO ${table(g, 's2compiled')}
                (s2lid,comptime,compdata) VALUES (?,1,?)`, [layer.id, active]);
            else await admin.query(`INSERT INTO ${table(layer.type === 'layout' ? other : c, 's2compiled2')}
                (userid,s2lid,comptime,compdata) VALUES (?,?,1,?)`, [ownerId, layer.id, gzipSync(active)]);
            await admin.query(`INSERT INTO ${table(c, 's2stylelayers2')} (userid,styleid,type,s2lid)
                VALUES (900001,44,?,?)`, [layer.type, layer.id]);
        }
        // The same numeric style ID owned by another journal is not authority.
        await admin.query(`INSERT INTO ${table(c, 's2stylelayers2')} (userid,styleid,type,s2lid)
            VALUES (900002,44,'user',999999)`);
        const snapshot = await repository.load(request); assert.ok(snapshot);
        assert.deepEqual(snapshot.program.layers.map(layer => layer.id), expected.layers.map(layer => layer.id));
        for (const [index, layer] of snapshot.program.layers.entries()) {
            assert.deepEqual(Buffer.from(layer.activeCompiledBytes), Buffer.from(expected.layers[index]!.activeBase64, 'base64'));
        }
        assert.equal(await repository.revalidate(snapshot), true);
        const incompleteRepository = new MysqlActivePrograms({...config, styles: {...config.styles,
            defaultStyle: {core: 'missing/core', layout: 'missing/layout'}}});
        try {
            const incomplete = await incompleteRepository.load({...request, selection: 'default'});
            assert.ok(incomplete);
            assert.deepEqual(incomplete.program.layers, []);
            assert.deepEqual(incomplete.selection.effective, expected.selection.incomplete);
        } finally {await incompleteRepository.close();}
        await admin.query(`UPDATE ${table(c, 's2stylelayers2')} SET s2lid=999998 WHERE userid=900002 AND styleid=44`);
        assert.equal(await repository.revalidate(snapshot), true);
        await admin.query(`UPDATE ${table(g, 'user')} SET clusterid=7 WHERE userid=900002`);
        assert.equal(await repository.revalidate(snapshot), false);
        await admin.query(`UPDATE ${table(g, 'user')} SET clusterid=19 WHERE userid=900002`);
        assert.equal(await repository.revalidate(snapshot), true);
        // Source property definitions choose global nonindexed storage, not a
        // convenient pre-existing cluster copy. Both definitions and bytes bind.
        await admin.query(`UPDATE ${table(g, 'userproplist')} SET cldversion=0,indexed='0',multihomed='0' WHERE upropid=?`, [prop('stylesys')]);
        await admin.query(`INSERT INTO ${table(g, 'userproplite')} (userid,upropid,value) VALUES (900001,?,'2')`, [prop('stylesys')]);
        assert.equal(await repository.revalidate(snapshot), false);
        const globalSettings = await repository.load(request); assert.ok(globalSettings);
        assert.equal(globalSettings.selection.styleId, 44);
        await admin.query(`UPDATE ${table(g, 's2layers')} SET type='theme' WHERE s2lid=?`, [expected.layers[0]!.id]);
        const metadata = await repository.load(request); assert.ok(metadata);
        assert.equal(metadata.program.layers[0]!.type, 'theme');
        assert.equal(metadata.selection.effective.core, expected.layers[0]!.id);
        await admin.query(`UPDATE ${table(g, 's2layers')} SET type='core' WHERE s2lid=?`, [expected.layers[0]!.id]);
        const user = expected.layers[3]!;
        await admin.query(`UPDATE ${table(g, 's2source_inno')} SET s2code=? WHERE s2lid=?`,
            [Buffer.from(user.sourceBase64, 'base64').toString().replace('userA', 'savedB'), user.id]);
        assert.equal(await repository.revalidate(snapshot), false);
        const saved = await repository.load(request); assert.ok(saved);
        assert.ok(Buffer.from(saved.program.layers[3]!.sourceBytes!).includes(Buffer.from('savedB')));
        assert.deepEqual(Buffer.from(saved.program.layers[3]!.activeCompiledBytes), Buffer.from(user.activeBase64, 'base64'));
        await admin.query(`DELETE FROM ${table(g, 's2source_inno')} WHERE s2lid=?`, [user.id]);
        const missingSource = await repository.load(request); assert.ok(missingSource);
        assert.equal(missingSource.program.layers[3]!.sourceBytes, null);
        await admin.query(`UPDATE ${table(other, 's2compiled2')} SET comptime=2 WHERE s2lid=?`, [expected.layers[1]!.id]);
        assert.equal(await repository.revalidate(missingSource), false);
        // Positive owner cluster never falls back to an unrelated global record.
        await admin.query(`INSERT INTO ${table(g, 's2compiled')} (s2lid,comptime,compdata) VALUES (?,9,?)`, [user.id, Buffer.from('WRONG_GLOBAL')]);
        await admin.query(`DELETE FROM ${table(c, 's2compiled2')} WHERE s2lid=?`, [user.id]);
        const optional = await repository.load(request); assert.ok(optional);
        assert.equal(optional.program.layers.some(layer => layer.type === 'user'), false);
        assert.equal(optional.dependencies.find(layer => layer.id === user.id)!.decodedSha256, null);
        // A missing critical compiled row follows configured native default.
        await admin.query(`DELETE FROM ${table(c, 's2compiled2')} WHERE s2lid=?`, [expected.layers[0]!.id]);
        const fallback = await repository.load(request); assert.ok(fallback);
        assert.equal(fallback.selection.origin, 'default');
        assert.ok(fallback.program.layers.every(layer => layer.ownerId === fallback.program.systemUserId));
        await admin.query(`UPDATE ${table(g, 'userproplite')} SET value='1' WHERE userid=900001 AND upropid=?`, [prop('stylesys')]);
        assert.equal(await repository.revalidate(fallback), false);
        await admin.query(`UPDATE ${table(g, 'useridmap')} SET user='moved_name' WHERE userid=900001`);
        await assert.rejects(() => repository.load(request), SnapshotError);
    } finally {await repository.close();}
}));
