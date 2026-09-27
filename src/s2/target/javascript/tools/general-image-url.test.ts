// general-image-url.test.ts
//
// Actual native known-HTTPS regex, scalar flags and explicit proxy omission.
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
import path from "node:path";
import {NativeString} from "../runtime/native-string";
import {normalizeGeneralImageUrl,prepareGeneralImageUrlFacts} from "../live/domain/general-image-url";
import type {NativeProfile} from "../runtime/native-profile";

test("image helper uses actual native domain capture/case/word class without proxying",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const domain=NativeString.hostUtf8Bytes("example.com");
    const extended=Buffer.from([0xf4,0x90,0x80,0x80]);
    const sites=[NativeString.hostUtf8Bytes("Known.com"),NativeString.hostUnicode("x.éé"),
        NativeString.flagged(Buffer.concat([extended,Buffer.from("x.com")]))];
    const values=["http://www.example.com/image","http://www.EXAMPLE.com/image","http://Known.com/x",
        "http://known.com/x","http://example.com","https://example.com/x","//example.com/x","http://else.invalid/x"]
        .map(value=>NativeString.hostUtf8Bytes(value));
    values.push(NativeString.hostUnicode("http://x.éé/x"),NativeString.hostUtf8Bytes("http://x.éé/x"));
    values.push(NativeString.flagged(Buffer.concat([Buffer.from("http://"),extended,Buffer.from("x.com/a")])));
    const wire=(value:NativeString)=>({base64:value.bytes().toString("base64"),utf8:value.flagged()});
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
        use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;use Encode ();use MIME::Base64 qw(decode_base64 encode_base64);
        BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::CleanHTML;
        sub pv {my $v=decode_base64($_[0]{base64});Encode::_utf8_on($v) if $_[0]{utf8};return $v;}
        local $/;my $input=decode_json(<STDIN>);local $LJ::DOMAIN=pv($input->{domain});
        local %LJ::KNOWN_HTTPS_SITES=map {pv($_)=>1} @{$input->{sites}};
        no warnings 'redefine';local *DW::Proxy::get_proxy_url=sub {my($url,%opts)=@_;
            die 'Unexpected cleaner context' unless defined $opts{journal}&&$opts{journal} eq ''&&
                defined $opts{ditemid}&&$opts{ditemid} eq '';return undef;};
        my @out;for my $value(@{$input->{values}}){my $v=LJ::CleanHTML::https_url(pv($value),journal=>'',ditemid=>'');
            push @out,{base64=>encode_base64(utf8::is_utf8($v)?do{my $copy=$v;utf8::encode($copy);$copy}:$v,''),
                utf8=>utf8::is_utf8($v)?JSON::PP::true:JSON::PP::false};}
        print encode_json(\@out);`;
    const prepared=prepareGeneralImageUrlFacts({siteDomain:wire(domain),knownHttpsSites:sites.map(wire)});
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{input:JSON.stringify({domain:wire(domain),sites:sites.map(wire),values:values.map(wire)}),
        encoding:"utf8",timeout:10000}));
    assert.deepEqual(values.map(value=>wire(normalizeGeneralImageUrl(value,prepared,profile))),native);
});
