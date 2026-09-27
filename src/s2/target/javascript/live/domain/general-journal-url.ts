// general-journal-url.ts
//
// General public journal URL rules and the reached installed hook.
//
// Portions adapted from LJ::journal_base, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import type {PublicAppConfig} from "../contracts";
import {NativeString} from "../../runtime/native-string";
import {scalarTruthy} from "../../runtime/native-scalar";

export interface JournalUrlUser {readonly username:string;readonly journaltype:string;}
export type InstalledJournalBaseHook=(user:JournalUrlUser,vhost:NativeString)=>NativeString|undefined;
/** Native URL construction, not an HTML sanitizer or a navigation grant. */
export function generalJournalBase(user:JournalUrlUser,config:PublicAppConfig,
    installedHook?:InstalledJournalBaseHook,vhost=NativeString.hostUtf8Bytes("")):NativeString {
    const rules=config.journalUrls;
    if(rules.hookConfigured) {
        // The caller installs source-qualified behavior; presence alone cannot
        // invent its return value. Missing wiring is infrastructure unfinished,
        // never an account/style admission exclusion.
        if(!installedHook)throw new Error("Installed journal-base hook is not wired");
        const result=installedHook(user,vhost);
        if(scalarTruthy(result)) {
            if(!NativeString.is(result))throw new Error("Invalid installed journal-base result");
            return result;
        }
    }
    const rule=rules.subdomainRules[user.journaltype]??rules.subdomainRules.P;
    if(!rule)throw new Error("Site misconfigured, no SUBDOMAIN_RULES");
    const username=user.username;
    let url:string;
    if(rule[0]&&!username.startsWith("_")&&!username.endsWith("_")) {
        url=`${rules.protocol}://${username.replace(/_/g,"-")}.${rules.domain}`;
    }else if(!rule[1]&&rules.isDevServer) {
        // The private viewer's approved request origin supplies the native dev
        // request-host context. Forwarded/client header strings never select it.
        url=`${rules.protocol}://${new URL(config.canonicalAppOrigin).host}/~${username}`;
    }else url=`${rules.protocol}://${rule[1]}/${username}`;
    return NativeString.hostUtf8Bytes(url);
}
