// general-public-session.ts
//
// Request-scoped public helper witnesses and the final authority reread.
//
// Portions adapted from LJ::User::Account and LJ::S2, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. See LICENSE in this distribution.
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

import type {PublicUserSnapshot} from "../data/public-users";
import type {PublicEncodingSnapshot} from "../data/public-encodings";
import type {PublicTranslationSnapshot} from "../data/public-translations";
import type {PublicMaintainerSnapshot} from "../data/public-maintainers";
import type {PublicCommentAnonymitySnapshot} from "../data/public-comment-authors";
import type {SubjectTranslationName,GeneralMlLookup,GeneralMlRequestContext} from "./public-translation";
import {NativeString} from "../../runtime/native-string";
import {caseString} from "../../runtime/native-string";
import {nativeCharacterClass, type NativeProfile} from "../../runtime/native-profile";
import {isNativeProgramError} from "../../runtime/native-scalar";

interface PublicUsers {
    snapshot(name: string): Promise<PublicUserSnapshot>;
    revalidate(snapshot: PublicUserSnapshot): Promise<boolean>;
}
interface PublicEncodings {
    snapshot(): Promise<PublicEncodingSnapshot>;
    revalidate(snapshot: PublicEncodingSnapshot): Promise<boolean>;
}
interface PublicMaintainers {
    snapshot(journalId:number,posterId:number):Promise<PublicMaintainerSnapshot>;
    revalidate(snapshot:PublicMaintainerSnapshot):Promise<boolean>;
}
interface PublicCommentAuthors {
    snapshot(ownerId:number,posterId:number,ownerType:string,
        posterName:string):Promise<PublicCommentAnonymitySnapshot>;
    revalidate(snapshot:PublicCommentAnonymitySnapshot):Promise<boolean>;
}
interface PublicTranslations {
    snapshot(name: SubjectTranslationName): Promise<PublicTranslationSnapshot>;
    snapshotCode?(code:NativeString|undefined):Promise<PublicTranslationSnapshot>;
    snapshotContext?(context:GeneralMlLookup):Promise<PublicTranslationSnapshot>;
    revalidate(snapshot: PublicTranslationSnapshot): Promise<boolean>;
}

/** Account.pm canonical_username: lower, native whitespace, hyphen translation. */
export function canonicalPublicUsername(input: NativeString, profile: NativeProfile,
    maximum: number): string {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid username bound");
    const lowered = caseString(input, "lower", profile);
    // Byte mode iterates original octets; flagged mode uses the installed Perl
    // character profile. This is a helper interpretation, never an output codec.
    const points = lowered.flagged() ? Array.from(lowered.bytes().toString("utf8"),
        value => value.codePointAt(0)!) : Array.from(lowered.bytes());
    let first = 0, last = points.length;
    while (first < last && nativeCharacterClass(profile, "space", points[first]!, lowered.flagged())) first++;
    while (last > first && nativeCharacterClass(profile, "space", points[last - 1]!, lowered.flagged())) last--;
    if (last === first || last - first > maximum) return "";
    const result: string[] = [];
    for (let index = first; index < last; index++) {
        const point = points[index]!;
        if (!(point >= 97 && point <= 122 || point >= 48 && point <= 57 || point === 95 || point === 45)) return "";
        result.push(String.fromCharCode(point === 45 ? 95 : point));
    }
    return result.join("");
}

/** Parent-only: facts are projected by the installed public helper, not this collector. */
export class GeneralPublicSession {
    private state: "open" | "checking" | "complete" | "failed" = "open";
    private readonly users: PublicUserSnapshot[] = [];
    private readonly translations: PublicTranslationSnapshot[] = [];
    private readonly encodings: PublicEncodingSnapshot[] = [];
    private readonly maintainers:PublicMaintainerSnapshot[]=[];
    private readonly commentAuthors:PublicCommentAnonymitySnapshot[]=[];
    private pending = 0;
    constructor(private readonly userStore: PublicUsers, private readonly translationStore: PublicTranslations,
        private readonly profile: NativeProfile, private readonly usernameMaximum: number,
        private readonly encodingStore?: PublicEncodings,
        private readonly languageContext?:GeneralMlRequestContext,
        private readonly maintainerStore?:PublicMaintainers,
        private readonly commentAuthorStore?:PublicCommentAuthors) {}
    /** The child initialization result precedes native S2's language merge. */
    afterContextInitialization():void {
        this.assertOpen();
        if(this.pending)throw Error("Public helper operation is pending");
        if(!this.languageContext)throw Error("Request language context is not installed");
        this.languageContext.afterContextInitialization();
    }
    private assertOpen(): void {
        if (this.state !== "open") throw new Error("Public helper session is closed");
    }
    async user(input: NativeString): Promise<PublicUserSnapshot | null> {
        this.assertOpen();
        const name = canonicalPublicUsername(input, this.profile, this.usernameMaximum);
        if (!name) return null;
        this.pending++;
        try {
            const witness = await this.userStore.snapshot(name);
            this.assertOpen(); this.users.push(witness); return witness;
        } catch (error) {this.state = "failed"; throw error;}
        finally {this.pending--;}
    }
    async translation(name: SubjectTranslationName): Promise<PublicTranslationSnapshot> {
        this.assertOpen(); this.pending++;
        try {
            const witness = await this.translationStore.snapshot(name);
            this.assertOpen(); this.translations.push(witness); return witness;
        } catch (error) {this.state = "failed"; throw error;}
        finally {this.pending--;}
    }
    /** Keys originate in validated parent image descriptors, not author IPC. */
    async imageTranslation(code:NativeString|undefined):Promise<PublicTranslationSnapshot> {
        this.assertOpen();
        if(!this.translationStore.snapshotContext||!this.languageContext)
            throw new Error("Installed request language context is unavailable; re-export configuration");
        this.pending++;
        try {
            const witness=await this.translationStore.snapshotContext(this.languageContext.resolve(code));
            this.assertOpen();this.translations.push(witness);
            if(witness.error)throw witness.error;
            return witness;
        }catch(error){if(!isNativeProgramError(error))this.state="failed";throw error;}
        finally{this.pending--;}
    }
    /** Source text_convert reaches the public mapping only after non-ASCII detection. */
    async encoding(): Promise<PublicEncodingSnapshot> {
        this.assertOpen();
        if (!this.encodingStore) throw new Error("Public encoding store is not installed");
        this.pending++;
        try {
            const witness = await this.encodingStore.snapshot();
            this.assertOpen(); this.encodings.push(witness); return witness;
        } catch (error) {this.state = "failed"; throw error;}
        finally {this.pending--;}
    }
    /** Trusted selected-entry projection only; there is no child maintainer operation. */
    async entryMaintainer(journalId:number,posterId:number):Promise<boolean> {
        this.assertOpen();
        if(!this.maintainerStore)throw Error("Community maintainer authority is not installed");
        this.pending++;
        try {
            const witness=await this.maintainerStore.snapshot(journalId,posterId);
            this.assertOpen();
            if(witness.journalId!==journalId||witness.posterId!==posterId)
                throw Error("Community maintainer witness mismatch");
            this.maintainers.push(witness);return witness.canManage;
        }catch(error){this.state="failed";throw error;}
        finally{this.pending--;}
    }
    /** Only selected shown identity posters require a current cleaner-trust edge. */
    async commentAnonymous(ownerId:number,posterId:number,ownerType:string,
        posterName:string):Promise<boolean> {
        this.assertOpen();
        if(!this.commentAuthorStore)throw Error("Comment identity authority is not installed");
        this.pending++;
        try {
            const witness=await this.commentAuthorStore.snapshot(ownerId,posterId,ownerType,posterName);
            this.assertOpen();
            if(witness.ownerId!==ownerId||witness.posterId!==posterId||
                witness.ownerType!==ownerType||witness.posterName!==posterName)
                throw Error("Comment identity witness mismatch");
            this.commentAuthors.push(witness);return witness.anonymous;
        }catch(error){this.state="failed";throw error;}
        finally{this.pending--;}
    }
    /** Complete selected journal/program authority is the LAST await before release. */
    async finish(recheckAuthority: () => Promise<boolean>): Promise<boolean> {
        this.assertOpen();
        if (this.pending) throw new Error("Public helper operation is pending");
        this.state = "checking";
        try {
            for (const witness of this.users) if (!await this.userStore.revalidate(witness)) {
                this.state = "failed"; return false;
            }
            for (const witness of this.translations) if (!await this.translationStore.revalidate(witness)) {
                this.state = "failed"; return false;
            }
            for (const witness of this.encodings) if (!await this.encodingStore!.revalidate(witness)) {
                this.state = "failed"; return false;
            }
            for(const witness of this.maintainers)if(!await this.maintainerStore!.revalidate(witness)) {
                this.state="failed";return false;
            }
            for(const witness of this.commentAuthors)if(!await this.commentAuthorStore!.revalidate(witness)) {
                this.state="failed";return false;
            }
            const current = await recheckAuthority();
            this.state = current ? "complete" : "failed";
            return current;
        } catch (error) {this.state = "failed"; throw error;}
    }
}
