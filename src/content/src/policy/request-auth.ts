// request-auth.ts
//
// Native support-request authentication removal before content parsing.
//
// Text transformation adapts LJ::strip_request_auth, forked from the LiveJournal
// project owned and operated by Live Journal, Inc., and modified and expanded by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// Native inputs are byte strings: \S excludes ASCII whitespace and \w is ASCII.
// Apply once to original source, before entity decoding; &amp;auth is not a match.
export function stripRequestAuth(source: string): string {
    return source.replace(/(see_request[^\t\n\v\f\r ]+?)&auth=[A-Za-z0-9_]+/gi, "$1");
}
