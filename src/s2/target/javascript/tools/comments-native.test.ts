// comments-native.test.ts
//
// Independent retained helper facts for the public comment selection boundary.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {selectComments,type CommentNode} from '../live/domain/comments';
import type {RawCommentHeader} from '../live/contracts';

const specs:Record<string,(number|string)[][]>={
    small:[[1,0,'A',1],[2,1,'A',1],[3,0,'F',1]],
    states:[[1,0,'S',1],[2,1,'A',1],[3,0,'D',1],[4,3,'A',1],[5,0,'S',1],
        [6,0,'D',1],[7,0,'A',2],[8,0,'F',1]],
    pages:Array.from({length:5},(_,i)=>[i+1,0,'A',1]),
    collapse:[[1,0,'A',1],[2,1,'A',1],[3,1,'A',1],[4,2,'A',1],[5,3,'A',1],[6,0,'A',1]],
};

test('retained load_comments supplies independent tree, root pagination and thread alias facts',()=>{
    const root=path.resolve(__dirname,'../../../../../..');
    const run=spawnSync('/usr/bin/perl',[path.join(root,'src/s2/target/javascript/tools/native-comments.pl')],
        {cwd:root,env:{...process.env,LJHOME:root},timeout:10000,maxBuffer:524288,encoding:'utf8'});
    if(run.error)throw run.error;
    assert.equal(run.status,0,run.stderr.toString());
    const observations=JSON.parse(run.stdout.toString()) as any[];
    assert.equal(observations.length,53);
    let checked=0;
    for(const row of observations) {
        const spec=specs[row.case];if(!spec)continue;
        const headers:RawCommentHeader[]=spec.map(([id,parent,state,poster])=>({jtalkid:Number(id),
            parenttalkid:Number(parent),posterid:Number(poster),state:String(state),datepost:'2026-09-26 00:00:00'}));
        const query={...(row.request.page!==undefined?{page:row.request.page}:{}),
            ...(row.request.thread!==undefined?{thread:row.request.source_dtalkid??row.request.thread*256}:{})};
        const actual=selectComments(headers,query,{pageSize:2,threadPoint:4,maxSubjects:3},true);
        const native=(nodes:any[]):any[]=>nodes.map(n=>({id:n.talkid,state:n.state,show:!!n._show,
            children:native(n.children)}));
        const candidate=(nodes:CommentNode[]):any[]=>nodes.map(n=>({id:n.header.jtalkid,state:n.header.state,
            show:n.show,children:candidate(n.children)}));
        assert.deepEqual(candidate(actual.roots),native(row.tree),JSON.stringify(row.request));
        assert.deepEqual([actual.page,actual.pages,actual.first,actual.last,actual.items],
            [row.nav.out_page,row.nav.out_pages,row.nav.out_itemfirst,row.nav.out_itemlast,row.nav.out_items]);
        checked++;
    }
    assert.equal(checked,31);
    for(const row of observations.filter(row=>row.case==='native-comment-enabled')) {
        if(row.show==='Y'&&!row.disabled)assert.equal(row.info.count,5);
    }
    for(const row of observations.filter(row=>row.case==='actual-source-redaction')) {
        if(row.state==='S'||row.state==='D'||row.poster===2) {
            assert.equal(row.result.subject,'');assert.equal(row.result.text,'');assert.equal(row.result.full,0);
        }
    }
    const deep=spawnSync('/usr/bin/perl',[path.join(root,'src/s2/target/javascript/tools/native-comments.pl'),'--depth'],
        {cwd:root,env:{...process.env,LJHOME:root},timeout:10000,maxBuffer:524288,encoding:'utf8'});
    assert.equal(deep.status,0,deep.stderr);
    let tree=JSON.parse(deep.stdout),depth=-1;
    while(tree.length){assert.equal(tree.length,1);depth++;tree=tree[0].children;}
    assert.equal(depth,181);
});

test('native comment_info evaluates threshold after effective count and preserves scalar read count',()=>{
    const root=path.resolve(__dirname,'../../../../../..');
    const run=spawnSync('/usr/bin/perl',[path.join(root,'src/s2/target/javascript/tools/native-comments.pl'),'--threshold'],
        {cwd:root,env:{...process.env,LJHOME:root},timeout:10000,maxBuffer:524288,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(JSON.parse(run.stdout),[
        {count:4,maxcomments:0,show_readlink:4}, {count:5,maxcomments:1,show_readlink:5},
        {count:0,maxcomments:1,show_readlink:0}, {count:0,maxcomments:0,show_readlink:0}]);
});
