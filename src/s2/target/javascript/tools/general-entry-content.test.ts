// general-entry-content.test.ts
//
// Native Entry content order and complete-token nohtml quoting.
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
import {NativeString} from "../runtime/native-string";
import {prepareGeneralEntryContent,quoteGeneralEntryHtml,type GeneralEntryContentInput,type GeneralEntryEventOptions} from "../live/domain/general-entry-content";
const pv=NativeString.hostUtf8Bytes;

test("Entry quote_html preserves original token bytes and native LJ exception",()=>{
    const values=["<b>x</b><lj user=\"name\"><LJ-CUT>body</LJ-CUT>","<a\nx>z</a>","a<3>b",Buffer.from([0xff,60,98,62])];
    const oracle=String.raw`use strict;use warnings;BEGIN {require DBI;no warnings 'redefine';
        *DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}use lib '/workspaces/dreamwidth/cgi-bin';
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::CleanHTML;
        use JSON::PP;use MIME::Base64 qw(decode_base64 encode_base64);local $/;my $rows=decode_json(<STDIN>);
        print encode_json([map{encode_base64(LJ::CleanHTML::quote_html(decode_base64($_),1),'')}@$rows]);`;
    const inputs=values.map(value=>Buffer.isBuffer(value)?value:Buffer.from(value));
    const expected=JSON.parse(execFileSync("perl",["-e",oracle],{
        input:JSON.stringify(inputs.map(value=>value.toString("base64"))),encoding:"utf8",timeout:10000}));
    assert.deepEqual(inputs.map(value=>quoteGeneralEntryHtml(NativeString.bytes(value),1)!.bytes().toString("base64")),expected);
});

test("original Entry content retains two embedding identities, false paths and no-body suppression",()=>{
    const input:GeneralEntryContentInput={subject:pv("title"),event:pv("body"),journalName:pv("journal"),
        ditemid:261,jitemid:1,editor:pv("rte0"),preformatted:0,importSourceDefined:true,isSyndicated:0,
        logtimeMysql:pv("2026-09-27 00:00:00"),suspendMessage:0,noEntryBody:0,noHtml:0,
        cutUrl:pv("/261.html"),cutDisable:0};
    const trace:string[]=[];
    const operations={cleanSubject(value:NativeString){trace.push("subject");return value;},
        cleanEvent(value:NativeString,options:GeneralEntryEventOptions){trace.push("event");assert.equal(options.isImported,true);
            assert.equal(options.preformatted,0);assert.equal(options.ditemid,261);return value;},
        expandEmbedded(value:NativeString|undefined,id:unknown,stage:string){trace.push(stage+":"+id);return value;},
        transformAdult(value:NativeString|undefined){trace.push("adult");return value;},
};
    const result=prepareGeneralEntryContent(input,operations);
    assert.deepEqual(trace,["subject","event","entry-event:261","s2-entry:1","adult"]);
    assert.equal(result.text!.bytes().toString(),"body");trace.length=0;
    assert.equal(prepareGeneralEntryContent({...input,noEntryBody:1},operations).text!.bytes().toString(),"");
    assert.deepEqual(trace,["subject"]);trace.length=0;
    assert.equal(prepareGeneralEntryContent({...input,subject:pv("0"),event:pv("0")},operations).text!.bytes().toString(),"0");
    assert.deepEqual(trace,["entry-event:261","s2-entry:1","adult"]);
});


test("actual native Entry event_html binds import definedness and the external embedding ID",()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        use lib '/workspaces/dreamwidth/cgi-bin';require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
        require LJ::Entry;use JSON::PP;my @trace;my $options;
        {package ContentJournal;sub user{'journal'}sub is_syndicated{0}}
        no warnings 'redefine';local *LJ::get_remote=sub{undef};local *LJ::User::remote=sub{undef};
        local *LJ::Entry::should_show_suspend_msg_to=sub{0};
        local *LJ::CleanHTML::clean_event=sub{my($ref,$opts)=@_;push @trace,'event';
            $options={map{$_=>$opts->{$_}}qw(preformatted journal ditemid is_syndicated is_imported editor logtime_mysql)};$$ref='clean';};
        local *LJ::expand_embedded=sub{push @trace,'embed:'.$_[1]};
        my $entry=bless {_loaded_props=>1,_loaded_text=>1,_loaded_row=>1,props=>{editor=>'rte0',opt_preformatted=>0,import_source=>'0'},
            u=>bless({},'ContentJournal'),ditemid=>261,event=>'body',logtime=>'2026-09-27 00:00:00'},'LJ::Entry';
        my $result=$entry->event_html({cuturl=>'/261.html'});
        print encode_json({trace=>\@trace,options=>$options,value=>$result});`;
    const actual=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    assert.deepEqual(actual,{trace:["event","embed:261"],options:{preformatted:0,journal:"journal",ditemid:261,
        is_syndicated:0,is_imported:1,editor:"rte0",logtime_mysql:"2026-09-27 00:00:00"},value:"clean"});
});
