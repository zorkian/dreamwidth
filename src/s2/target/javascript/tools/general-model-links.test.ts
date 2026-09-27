// general-model-links.test.ts
//
// Actual native public UserLink field escaping and alias semantics.
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

import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {generalUserLink} from "../live/domain/general-model-links";
import {NativeString} from "../runtime/native-string";

test("UserLink preserves native dash mutation, false URL and children alias",()=>{
    const rows=[{title:"-",url:"",hover:"<quote>"},{title:"a&\"b",url:"/rel?a=1&b=2",hover:"'"},
        {title:"zero",url:"0",hover:""}];
    const oracle=String.raw`use strict;use warnings;use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
        *DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;local $/;
        my $rows=decode_json(<STDIN>);my @out;for my $row(@$rows){my $v=LJ::S2::UserLink($row);
        push @out,{title=>$v->{title},url=>$v->{url},hover=>$v->{hover},is_heading=>$v->{is_heading},
            mutated=>$row->{title}};}print encode_json(\@out);`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{input:JSON.stringify(rows),encoding:"utf8",timeout:10000}));
    const actual=rows.map(row=>{const model=generalUserLink(row);
        const text=(v:unknown)=>(v as NativeString).bytes().toString("utf8");
        return {title:text(model._title),url:text(model._url),hover:text(model._hover),is_heading:model._is_heading,
            mutated:NativeString.is(row.title)?row.title.bytes().toString("utf8"):row.title};});
    assert.deepEqual(actual,native);
    const children=[{}];assert.equal(generalUserLink({title:"x",url:"/",hover:"",children})._children,children);
});
