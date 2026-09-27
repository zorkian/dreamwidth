// general-comment-navigation.ts
//
// Native comment-navigation constructors and private URL callback authority.
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
// Semantic ports from LJ/S2.pm, originally forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and subsequently modified by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. A copy of that license is
// included in the LICENSE file in this distribution.
//
import { type BuiltinFunction } from '../../runtime/s2runtime';
import { NativeString, NativeNumber, scalarNumber } from '../../runtime/native-scalar';
import { arithmetic, numericCompare } from '../../runtime/native-number';
import type { GeneralModel } from './general-model-primitives';
export interface GeneralCommentNavigation {
    itemRange(options: GeneralModel, urlOf?: (n: unknown) => unknown): GeneralModel;
    commentNav(options: GeneralModel): GeneralModel;
    readonly callbacks: Record<string, BuiltinFunction>;
}
/** Only the trusted constructor can attach URL authority to an original model. */
export function generalCommentNavigation(): GeneralCommentNavigation {
    const bindings = new WeakMap<GeneralModel, (n: unknown) => unknown>();
    const empty = () => NativeString.hostUtf8Bytes('');
    function itemRange(options: GeneralModel, urlOf?: (n: unknown) => unknown): GeneralModel {
        options['.type'] = 'ItemRange';
        if (urlOf !== undefined)
            bindings.set(options, urlOf);
        const callback = bindings.get(options) ?? empty;
        // Re-read each field after the preceding trusted callback, as native does.
        if (!(numericCompare(scalarNumber(options._current), scalarNumber(options._total)) >= 0))
            options._url_next = callback(arithmetic('+', scalarNumber(options._current), NativeNumber.integer(1n)));
        if (!(numericCompare(scalarNumber(options._current), NativeNumber.integer(1n)) <= 0))
            options._url_prev = callback(arithmetic('-', scalarNumber(options._current), NativeNumber.integer(1n)));
        if (numericCompare(scalarNumber(options._current), NativeNumber.integer(1n)) !== 0)
            options._url_first = callback(NativeNumber.integer(1n));
        if (numericCompare(scalarNumber(options._current), scalarNumber(options._total)) !== 0)
            options._url_last = callback(options._total);
        return options;
    }
    return { itemRange, commentNav(options) { options['.type'] = 'CommentNav'; return options; }, callbacks: {
            _ItemRange__url_of: (_ctx, model: GeneralModel, n: unknown) => {
                const callback = bindings.get(model);
                return callback ? callback(arithmetic('+', scalarNumber(n), NativeNumber.integer(0n))) : empty();
            },
        } };
}
