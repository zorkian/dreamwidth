// general-userpic-image.ts
//
// Native selected userpic Image construction from resolved public facts.
//
// Portions adapted from LJ::S2::Image_userpic and LJ::Userpic text methods, forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and modified by Dreamwidth Studios,
// LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, adapted portions and modifications are
// provided under the GNU General Public License; see LICENSE.
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
import { NativeString, scalarTruthy, scalarConcat } from '../../runtime/native-scalar';
import { escapeNativeHtml } from '../render/general-diagnostics';
import { generalImage, generalNull, type GeneralModel } from './general-model-primitives';
export interface GeneralUserpicImageInput {
    readonly userid: unknown;
    readonly picid: unknown;
    readonly root: NativeString;
    readonly username: NativeString | undefined;
    readonly width: unknown;
    readonly height: unknown;
    readonly description: NativeString | undefined;
    readonly keyword: NativeString | undefined;
}
/** Picid and dimensions are already resolved by the installed parent caller. */
export function generalUserpicImage(input: GeneralUserpicImageInput): GeneralModel {
    if (!scalarTruthy(input.picid))
        return generalNull('Image');
    const bytes = NativeString.hostUtf8Bytes;
    let alt = scalarConcat(input.username, bytes(':')), title = scalarConcat(input.username, bytes(':'));
    if (scalarTruthy(input.description))
        alt = scalarConcat(scalarConcat(alt, bytes(' ')), input.description);
    if (input.keyword !== undefined) {
        alt = scalarConcat(scalarConcat(scalarConcat(alt, bytes(' (')), input.keyword), bytes(')'));
        title = scalarConcat(scalarConcat(title, bytes(' ')), input.keyword);
    }
    else {
        alt = scalarConcat(alt, bytes(' (Default)'));
        title = scalarConcat(title, bytes(' (Default)'));
    }
    if (scalarTruthy(input.description))
        title = scalarConcat(scalarConcat(scalarConcat(title, bytes(' (')), input.description), bytes(')'));
    const url = scalarConcat(scalarConcat(scalarConcat(scalarConcat(input.root, bytes('/')), input.picid), bytes('/')), input.userid);
    return generalImage(url, input.width, input.height, escapeNativeHtml(alt), [[bytes('title'), escapeNativeHtml(title)]]);
}
