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
import {MysqlActivePrograms} from '../live/data/active-program';
import {SnapshotError} from '../live/data/errors';
import {selectActiveStyle, publicLayerAliases, activeStyleId} from '../live/domain/active-style';
import {withSelectedFixture} from './selected-fixture';

function native() {
    return JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=536870912', '--cpu=5', '--', '/usr/bin/perl',
        resolve('tools/active-style-native.pl')], {timeout: 10000, maxBuffer: 1048576}).toString()) as {
        layers: {id: number; type: string; parentId: number; sourceBase64: string}[];
        outputBase64: string; selection: {persisted: Record<string, number>; default: Record<string, number>; siteviews: Record<string, number>; incomplete: Record<string, number>; sitefeeds: Record<string, number>;
            feedInfo: [number, string]; corruptGzipAbsent: boolean};
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
    assert.deepEqual(expected.selection.feedInfo, [2, 'sitefeeds']);
    assert.equal(expected.selection.corruptGzipAbsent, true);
    const feed = selectActiveStyle(44, {core: 1, user: 2}, aliases, {...config,
        defaultFeedStyle: {core: 'core2', layout: 'fixture/layout', theme: 'missing/theme'}},
        {...request, selection: 'sitefeeds'});
    assert.equal(feed.origin, 'sitefeeds');
    assert.deepEqual(feed.effective, expected.selection.sitefeeds);
    assert.deepEqual(feed.unresolvedRoles, []);
    assert.deepEqual(expected.syntheticWrites, ['status', 'remap']);
    assert.equal(activeStyleId({stylesys: '2abc', s2_style: '44'}), 44);
});

test('selected source and owner facts are bracketed without stored compiled code', {
    skip: process.env.S2_SELECTED_FIXTURE !== '1',
}, async () => withSelectedFixture(async ({admin, g, c, table, startup, prop}) => {
    const expected = native();
    const config = {...startup, styles: {...startup.styles, siteSchemeInheritance: ['global']}};
    const repository = new MysqlActivePrograms(config);
    const request = {username: 'ordinary6', view: 'recent', selection: 'journal'} as const;
    try {
        await admin.query(`INSERT INTO ${table(g, 'user')} (userid,user,name,clusterid,status,statusvis,journaltype,dversion,caps)
            VALUES (900003,'zero_owner','Zero owner',0,'A','V','P',10,2)`);
        await admin.query(`INSERT INTO ${table(g, 'useridmap')} (userid,user) VALUES (900003,'zero_owner')`);
        await admin.query(`DELETE FROM ${table(c, 's2stylelayers2')} WHERE userid=900001 AND styleid=44`);
        for (const layer of expected.layers) {
            const ownerId = layer.type === 'layout' ? 900002 : layer.type === 'theme' ? 900003 : 900001;
            await admin.query(`INSERT INTO ${table(g, 's2layers')} (s2lid,userid,b2lid,type)
                VALUES (?,?,?,?)`, [layer.id, ownerId, layer.parentId, layer.type]);
            await admin.query(`INSERT INTO ${table(g, 's2source_inno')} (s2lid,s2code) VALUES (?,?)`,
                [layer.id, Buffer.from(layer.sourceBase64, 'base64')]);
            await admin.query(`INSERT INTO ${table(c, 's2stylelayers2')} (userid,styleid,type,s2lid)
                VALUES (900001,44,?,?)`, [layer.type, layer.id]);
        }
        const snapshot = await repository.load(request); assert.ok(snapshot);
        assert.deepEqual(snapshot.program.layers.map(layer => layer.id), expected.layers.map(layer => layer.id));
        for (const [index, layer] of snapshot.program.layers.entries()) {
            assert.deepEqual(Buffer.from(layer.sourceBytes!),
                Buffer.from(expected.layers[index]!.sourceBase64, 'base64'));
        }
        assert.equal(await repository.revalidate(snapshot), true);
        // The stored Perl code is neither a program input nor a freshness witness.
        await admin.query(`UPDATE ${table(g, 's2compiled')} SET compdata='obsolete compiled program'`);
        assert.equal(await repository.revalidate(snapshot), true);
        await admin.query(`INSERT INTO ${table(c, 's2compiled2')} (userid,s2lid,comptime,compdata)
            VALUES (900001,?,1,'unrelated compiled program')`, [expected.layers[3]!.id]);
        assert.equal(await repository.revalidate(snapshot), true);
        // Another account owning the same style number cannot select this user's layers.
        await admin.query(`INSERT INTO ${table(c, 's2stylelayers2')} (userid,styleid,type,s2lid)
            VALUES (900002,44,'user',999999)`);
        assert.equal(await repository.revalidate(snapshot), true);
        await admin.query(`UPDATE ${table(g, 'user')} SET clusterid=7 WHERE userid=900002`);
        assert.equal(await repository.revalidate(snapshot), false);
        await admin.query(`UPDATE ${table(g, 'user')} SET clusterid=19 WHERE userid=900002`);
        assert.equal(await repository.revalidate(snapshot), true);
        const user = expected.layers[3]!;
        await admin.query(`UPDATE ${table(g, 's2source_inno')} SET s2code=? WHERE s2lid=?`,
            [Buffer.from(user.sourceBase64, 'base64').toString().replace('userA', 'savedB'), user.id]);
        assert.equal(await repository.revalidate(snapshot), false);
        const saved = await repository.load(request); assert.ok(saved);
        assert.ok(Buffer.from(saved.program.layers[3]!.sourceBytes!).includes(Buffer.from('savedB')));
        await admin.query(`DELETE FROM ${table(g, 's2source_inno')} WHERE s2lid=?`, [user.id]);
        await assert.rejects(() => repository.load(request), SnapshotError);
        await admin.query(`INSERT INTO ${table(g, 's2source_inno')} (s2lid,s2code) VALUES (?,?)`,
            [user.id, Buffer.from(user.sourceBase64, 'base64')]);
        // Property routing and name identity remain private selection witnesses.
        await admin.query(`UPDATE ${table(g, 'userproplist')} SET cldversion=0,indexed='0',multihomed='0'
            WHERE upropid=?`, [prop('stylesys')]);
        await admin.query(`INSERT INTO ${table(g, 'userproplite')} (userid,upropid,value) VALUES (900001,?,'2')`,
            [prop('stylesys')]);
        assert.equal(await repository.revalidate(snapshot), false);
        await admin.query(`UPDATE ${table(g, 'useridmap')} SET user='moved_name' WHERE userid=900001`);
        await assert.rejects(() => repository.load(request), SnapshotError);
    } finally {await repository.close();}
}));
