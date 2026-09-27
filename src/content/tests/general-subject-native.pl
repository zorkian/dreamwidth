#!/usr/bin/perl
# general-subject-native.pl
#
# Independent native subject values, flags and eval effects from fixed inputs.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#
use strict;
use warnings;
no warnings 'once';
use FindBin;
use lib "$FindBin::Bin/../../../cgi-bin";
use LJ::CleanHTML;
use HTML::Parser;
use Encode qw(decode encode);
use JSON::PP;
use MIME::Base64 qw(encode_base64);
sub octets { use bytes; return substr( $_[0], 0 ) }
my @calls;
my $hook = 0;
{
    no warnings 'redefine';
    *LJ::get_dbh            = sub { die 'DB forbidden' };
    *LJ::get_cluster_master = sub { die 'DB forbidden' };
    *LJ::no_utf8_flag       = \&octets;
    *LJ::Hooks::are_hooks = sub { $hook };
    *LJ::Hooks::run_hook  = sub {
        my ( $name, $tokens, %opts ) = @_;
        push @calls,
            {
            kind    => 'embed',
            tokens  => JSON::PP->new->decode( JSON::PP->new->encode($tokens) ),
            nocheck => $opts{nocheck},
            wmode   => $opts{wmode}
            };
        return 'EMBED';
    };
    *LJ::valid_stylesheet_url = sub {
        my ( $href, $host, $path ) = @_;
        push @calls, { kind => 'stylesheet', host => $host, path => $path };
        eval { die "stylesheet helper effect\n" };
        return $host eq 'zero.test' ? 0 : $host eq 'two.test' ? 2 : 1;
    };
    *LJ::CleanHTML::https_url = sub {
        my ( $url, %opts ) = @_;
        push @calls, { kind => 'image', url => $url, opts => \%opts };
        eval { die "image helper effect\n" };
        return $url;
    };
    *LJ::CleanHTML::ExpandLJURL = sub {
        my ($path) = @_;
        push @calls, { kind => 'site', path => $path };
        return 'EXPAND:' . $path;
    };
    *LJ::Lang::ml = sub {
        my ( $key, $opts ) = @_;
        push @calls, { kind => 'ml', key => $key, aopts => $opts->{aopts} };
        return 'ML:' . $key . ':' . ( $opts->{aopts} // '' );
    };
    *LJ::CleanHTML::user_link_html = sub {
        my ( $name, $site, $opts ) = @_;
        push @calls,
            {
            kind     => 'user',
            name     => defined($name) ? encode_base64( octets($name), '' ) : undef,
            site     => defined($site) ? encode_base64( octets($site), '' ) : undef,
            nameFlag => Encode::is_utf8($name) ? JSON::PP::true : JSON::PP::false,
            siteFlag => Encode::is_utf8($site) ? JSON::PP::true : JSON::PP::false,
            opts     => {%$opts}
            };
        if ( defined($name) && $name eq 'effect-set' ) {
            eval { die "controlled helper failure\n" };
        }
        return
              'USER:'
            . ( defined($name) ? $name : 'UNDEF' ) . ':'
            . ( defined($site) ? $site : 'UNDEF' ) . ':'
            . $opts->{no_link} . ':'
            . $opts->{textonly};
    };
}
@LJ::BLOCKED_LINKS           = (qr/^https:\/\/blocked\.test\//);
$LJ::BLOCKED_LINK_SUBSTITUTE = '#blocked';
my @cases = (
    [
        'unicode-space',
        decode( 'UTF-8', qq{<a href="\xc2\xa0https://ordinary.test/x\xc2\xa0">x</a>} ), 1
    ],
    [ 'byte-space', qq{<a href="\xa0https://ordinary.test/x\xa0">x</a>}, 0 ],
    [
        'unicode-srcset',
        decode( 'UTF-8', qq{<img srcset="http://one.test/x\xc2\xa0HTTP://two.test/y">} ), 1
    ],
    [ 'unicode-word-version', decode( 'UTF-8', qq{<b titl\xe1\xb2\x89="x">x</b>} ), 1 ],
    [
        'unicode-name',
        decode( 'UTF-8', qq{<b\xc3\xa9>text</b\xc3\xa9><b titl\xc3\xa9="value">x</b>} ), 1
    ],
    [ 'flag-tag-only',         decode( 'UTF-8', '<b>' ),                        1 ],
    [ 'flag-ascii-attr',       decode( 'UTF-8', '<b title="x">' ),              1 ],
    [ 'flag-latin-attr',       decode( 'UTF-8', qq{<b title="\xc3\xa9">} ),     1 ],
    [ 'flag-wide-attr',        decode( 'UTF-8', qq{<b title="\xe7\x8c\xab">} ), 1 ],
    [ 'flag-latin-ascii-text', decode( 'UTF-8', qq{<b title="\xc3\xa9">x} ),    1 ],
    [
        'image',
'<img src=" http://image.test/x " srcset="http://image.test/a 1x, http://image.test/b 2x">tail'
    ],
    [ 'image-empty',       '<img src="javascript:bad">tail' ],
    [ 'image-clear',       '<img src="http://image.test/x"><b>tail</b>' ],
    [ 'href-zero',         '<a href="0">x</a>' ],
    [ 'href-space',        qq{<a href="\x85\xa0x\x85\xa0">x</a>} ],
    [ 'xsl-safe',          '<xsl:attribute name="type">text/plain</xsl:attribute>tail<b>x</b>' ],
    [ 'xsl-hostile',       '<xsl:attribute name="type">java script</xsl:attribute>tail<b>x</b>' ],
    [ 'xsl-entities',      '<xsl:attribute>one&amp;<img alt="image">two</xsl:attribute>tail' ],
    [ 'xsl-open',          '<xsl:attribute>one&amp;two' ],
    [ 'cut-default',       '<div class="ljcut">x</div>' ],
    [ 'cut-text',          '<div class="ljcut" text="0">x</div><cut text="z">y</cut>' ],
    [ 'meta-prefix',       '<ns:m-et_a http-equiv="refresh"><lj user="after">' ],
    [ 'entity-user',       '<lj name="&#x732b;&eacute;">' ],
    [ 'entity-user-latin', '<lj name="&eacute;">' ],
    [ 'slash-b',           '<b/>one' ],
    [ 'eaten-pi',          '<head><?hidden x?><!DOCTYPE html><!--c--></head>visible' ],
    [ 'hook-object',       '<object id="x">one<b>two</b><!--c--></object>tail' ],
    [ 'hook-self',         '<embed src="x" />tail' ],
    [ 'hook-unclosed',     '<object>hidden' ],
    [ 'prototype-names',   '<constructor>one</constructor><b __proto__="ok">two</b>' ],
    [ 'malformed-comment', 'a<3> b<> c<---> d<!--->tail' ],
    [ 'namespace-handler', '<ns:m-eta http-equiv="refresh"><lj user="after">' ],
    [ 'bare',              '<B TITLE disabled Checked=x Checked=y>x</B>' ],
    [
        'rte-textify',
        '<div class="ljuser" site=""><b>a&amp;b<br><img alt="image"><p>block</p>tail</b></div>'
    ],
    [ 'blocked-href',     '<a href="https://blocked.test/x">x</a>' ],
    [ 'site-href',        '<a href="site://faq/1">x</a>' ],
    [ 'denied-site-href', '<div href="lj:faq/2">x</div>' ],
    [ 'stylesheet-one',   '<link rel="stylesheet" href="https://one.test/css">x' ],
    [ 'stylesheet-zero',  '<link rel="stylesheet" href="https://zero.test/css">x' ],
    [ 'stylesheet-two',   '<link rel="stylesheet" href="https://two.test/css">x' ],
    [ 'marked',           'a<![CDATA[<b>x</b>]]>z' ],
    [ 'less-than',        'x < 3 and <unfinished' ],
    [ 'unfinished-quote', 'before<b title="unterminated' ],
    [ 'unfinished-start', 'before<b' ],
    [ 'unfinished-end',   '<b>x</b' ],
    [ 'literal-fake',     '<textarea>a<bad title="</textarea>tail' ],
    [
        'template-nested',
        '<lj-template name="a&amp;b">one<lj-template>two</lj-template>three</lj-template>tail'
    ],
    [ 'template-open', '<lj-template name="n">hidden' ],
    [ 'plain',         'literal &amp; and newline' . "\n" ],
    [ 'gt',            'one > two' ],
    [ 'format',        '<b>one<i>two</b>three' ],
    [ 'early',         '</b>one' ],
    [ 'attrs',         '<a href=" javascript:bad" title="a&amp;b" id="ljs_x" onclick="bad">x</a>' ],
    [ 'entities',      '<b title="&#x732b; &eacute;">&amp; x</b>' ],
    [ 'empty-user',    '<lj name="" user="fallback" site="">' ],
    [ 'missing-user',  '<lj>' ],
    [ 'user-precedence',      '<user name="first" user="second" comm="third">' ],
    [ 'anchor-user',          '<a href="#x"><lj user="inside"></a><lj user="after">' ],
    [ 'span-user',            '<a><span class="ljuser"><b>first</b>last</span></a>' ],
    [ 'div-user',             '<div class="ljuser" site="remote"><a><b>[old]name</b></a></div>' ],
    [ 'effect-set',           '<lj user="effect-set">' ],
    [ 'effect-cleared-later', '<lj user="effect-set"><b>x</b>' ],
    [ 'eat',                  '<head><lj user="hidden"></head>visible' ],
    [ 'eat-nested',           '<head>one<head>two</head>three</head>four' ],
    [ 'lf',                   "\n <b>body</b>\n" ],
    [ 'pre',                  "<pre>\n<b>x</b></pre>" ],
    [ 'textarea',             "<textarea>\n<b>x</b></textarea>" ],
    [ 'xmp',                  '<xmp><b>x</b></xmp>tail' ],
    [ 'literal-eof',          '<textarea>one<b>two' ],
    [ 'comment',              'a<!-- hidden -->b' ],
    [ 'pi',                   'a<?test x?>b' ],
    [ 'doctype',              '<!DOCTYPE html>body' ],
    [ 'form-control',         '<input type="text"><select><option>x</option></select>' ],
    [ 'cut',                  '<cut>one</cut><div class="ljcut" text="more">two</div>' ],
    [ 'template',             '<lj-template name="old-name">hidden</lj-template>tail' ],
    [ 'video',                '<div class="ljvideo">hidden</div>tail' ],
    [ 'invalid-tag',          '<bad.foo>x</bad.foo>tail' ],
    [ 'invalid-attr',         '<b data.foo="x">body</b>' ],
    [ 'raw-invalid',          qq{<b title="\xff">\xfe</b>} ],
    [ 'raw-utf8',             qq{<b title="\xc3\xa9">\xc3\xa9</b>} ],
    [ 'entity-latin',         '<b title="&eacute;">x</b>' ],
    [
        'anchor-events',
        '<a><lj user="first"></a></a><lj user="second"><span class="ljuser"><a>last</span>'
    ],
    [ 'rte-anchor',        '<a><div class="ljuser"><b>name</b></div></a>' ],
    [ 'denied-anchor-all', '<a><span class="ljuser">name</span><lj user="name"></a>' ],
    [ 'object',            '<object><b>inside</b></object>tail' ],
    [ 'flag-latin',  decode( 'UTF-8', qq{<b title="\xc3\xa9">\xc3\xa9</b>} ),         1 ],
    [ 'flag-wide',   decode( 'UTF-8', qq{<b title="\xe7\x8c\xab">\xe7\x8c\xab</b>} ), 1 ],
    [ 'auth-plain',  'see_request?id=1&auth=private' ],
    [ 'auth-parsed', '<b>see_request?id=1&auth=private</b>' ],
);
my @rows;
for my $case (@cases) {
    for my $mode (qw(subject all)) {
        @calls = ();
        my ( $id, $input ) = @$case;
        $hook = $id =~ /^hook-/ ? 1 : 0;
        my $value = $input;
        $@ = 'sentinel';
        if   ( $mode eq 'subject' ) { LJ::CleanHTML::clean_subject( \$value ) }
        else                        { LJ::CleanHTML::clean_subject_all( \$value ) }
        my $exception = $@;
        push @rows,
            {
            id              => $id,
            mode            => $mode,
            inputBase64     => encode_base64( octets($input), '' ),
            inputFlag       => $case->[2] ? JSON::PP::true : JSON::PP::false,
            outputBase64    => encode_base64( octets($value), '' ),
            outputFlag      => Encode::is_utf8($value) ? JSON::PP::true : JSON::PP::false,
            exceptionBase64 => encode_base64( octets($exception), '' ),
            calls           => [@calls]
            };
    }
}
print JSON::PP->new->canonical->encode( { parserVersion => $HTML::Parser::VERSION, rows => \@rows } );
