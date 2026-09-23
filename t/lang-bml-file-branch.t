#!/usr/bin/perl
# Characterizes LJ::Lang::get_text's '.bml.' from_files branch
# (LJ/Lang.pm ~617-623) ahead of E3's engine deletion: is it still reachable
# by any live caller, and what does it produce today.
#
# git ls-files '*.bml.text' returns nothing (confirmed on the host; worktree
# git metadata does not always resolve inside the devcontainer, so this test
# scans the working tree directly instead) -- every backing file the branch
# could read from htdocs/*.bml.text[.local] is gone. But the branch is not
# dead code: grepping cgi-bin/, views/, and ext/ for '.bml.' key literals
# (excluding deadphrases.dat and ext/dw-nonfree/bin/upgrading/deadphrases-local.dat,
# and excluding plain code comments) finds 14 live call sites across 6 files
# still asking LJ::Lang::ml()/->ml() for a '/....bml.something' key:
#   cgi-bin/LJ/Setting/Gender.pm            (4: gender.female/male/other/unspecified)
#   cgi-bin/LJ/Setting/BirthdayDisplay.pm   (4: show.birthday.nothing/day/year/full)
#   cgi-bin/DW/Controller/Entry.pm:1674     (1: /poll/create.bml.error.accttype2)
#   views/manage/index.tt                   (4: title, title.anon, tags.title2, circle/edit.title2)
#   views/manage/circle/index.tt:20         (1: /manage/circle/edit.bml.title3)
#   views/delcomment.tt:34                  (1: /manage/settings/index.bml.title.anon, same key as
#                                                one of manage/index.tt's four)
#
# On a dev server, get_text's dev-server branch (IS_DEV_SERVER && general
# domain && source language) calls from_files() UNCONDITIONALLY rather than
# as a fallback, and from_files() finds none of these files, so every one of
# these 14 keys currently renders as a literal "[missing string ...]" banner
# rather than real text on any dev server -- independent of E3 and not
# something E3 introduces. This test locks in that observed (broken)
# behaviour so a regression it didn't cause isn't pinned on E3, not because
# the behaviour is correct.
#
# W14 relocates all 14 keys to native homes and flips this file's second
# subtest to assert real text with no missing-string banner instead.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use File::Find;
use Test::More;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Lang;

plan skip_all => 'requires a development server (get_text\'s file-read branch is dev-only)'
    unless $LJ::IS_DEV_SERVER;

my @live_bml_keys = (
    '/manage/profile/index.bml.gender.female',
    '/manage/profile/index.bml.gender.male',
    '/manage/profile/index.bml.gender.other',
    '/manage/profile/index.bml.gender.unspecified',
    '/manage/profile/index.bml.show.birthday.nothing',
    '/manage/profile/index.bml.show.birthday.day',
    '/manage/profile/index.bml.show.birthday.year',
    '/manage/profile/index.bml.show.birthday.full',
    '/poll/create.bml.error.accttype2',
    '/manage/profile/index.bml.title',
    '/manage/settings/index.bml.title.anon',
    '/manage/tags.bml.title2',
    '/manage/circle/edit.bml.title2',
    '/manage/circle/edit.bml.title3',
);

subtest 'the from_files branch has no backing files left to read' => sub {
    my @text_files;
    find(
        {
            wanted => sub {
                push @text_files, $File::Find::name if -f $_ && /\.bml\.text$/;
            },
            no_chdir => 1,
        },
        "$ENV{LJHOME}/htdocs",
        "$ENV{LJHOME}/ext",
    );
    is_deeply( \@text_files, [], 'no remaining *.bml.text files under htdocs/ or ext/' );
};

subtest 'every live .bml. key currently renders as a missing-string banner' => sub {
    for my $key (@live_bml_keys) {
        ok( LJ::Lang::is_missing_string( LJ::Lang::ml($key) ),
            "$key currently resolves to a missing-string banner on a dev server" );
    }
};

done_testing;
