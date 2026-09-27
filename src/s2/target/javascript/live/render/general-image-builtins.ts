// general-image-builtins.ts
//
// Context-local native standard Image resources and URL assignment.
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
import { runtime, type Context, type BuiltinFunction } from '../../runtime/s2runtime';
import { NativeString, scalarPV, scalarConcat } from '../../runtime/native-scalar';
import { generalImage, type GeneralModel } from '../domain/general-model-primitives';
export interface GeneralImageOperations {
    sourceFacts(ctx: Context): {
        readonly prefix: NativeString;
        readonly images: readonly {
            readonly name: NativeString;
            readonly src: NativeString | undefined;
            readonly width: unknown;
            readonly height: unknown;
            readonly altKey: NativeString | undefined;
        }[];
    };
    translate(key: NativeString | undefined): unknown;
    escapeUrl(value: unknown): NativeString;
}
export interface GeneralImageCallbacks {
    readonly callbacks: Record<string, BuiltinFunction>;
    image(ctx: Context, name: unknown): GeneralModel | undefined;
    beginRendering(ctx: Context): void;
}
const propertyImages = [
    ['security-protected', 'text_icon_alt_protected'], ['security-private', 'text_icon_alt_private'],
    ['security-groups', 'text_icon_alt_groups'], ['adult-nsfw', 'text_icon_alt_nsfw'],
    ['adult-18', 'text_icon_alt_18'], ['sticky-entry', 'text_icon_alt_sticky_entry'],
    ['admin-post', 'text_icon_alt_admin_post'],
] as const;
const translatedImages = ['btn_del', 'btn_freeze', 'btn_unfreeze', 'btn_scr', 'btn_unscr',
    'editcomment', 'editentry', 'edittags', 'tellfriend', 'memadd', 'prev_entry', 'next_entry',
    'track', 'untrack', 'atom', 'rss'];
/** Trusted reset mirrors s2_run after initialization; held old Images remain unchanged. */
export function generalImageCallbacks(operations: GeneralImageOperations): GeneralImageCallbacks {
    const caches = new WeakMap<Context, unknown>();
    function image(ctx: Context, name: unknown): GeneralModel | undefined {
        let cache = caches.get(ctx);
        if (!cache) {
            // Native marks RES_MADE before helper calls; a failed translation must
            // not silently retry initialization and replay its side effects.
            cache = runtime.makeHash([]);
            caches.set(ctx, cache);
            const facts = operations.sourceFacts(ctx), descriptors = runtime.makeHash(facts.images.map(item => [item.name, item]));
            let prefix = facts.prefix;
            const raw = prefix.bytes();
            const count = raw.subarray(0, 5).equals(Buffer.from('http:')) ? 5 :
                raw.subarray(0, 6).equals(Buffer.from('https:')) ? 6 : 0;
            if (count)
                prefix = NativeString.fromFrame({ bytes: raw.subarray(count), utf8: prefix.flagged() });
            function add(key: string, alt: () => unknown): void {
                const descriptor = runtime.memberSlot(descriptors, NativeString.hostUtf8Bytes(key), 'hash').get() as {
                    src?: NativeString;
                    width?: unknown;
                    height?: unknown;
                    altKey?: NativeString;
                } | undefined;
                const value = generalImage(scalarConcat(prefix, descriptor?.src), descriptor?.width, descriptor?.height, alt());
                runtime.memberSlot(cache, NativeString.hostUtf8Bytes(key), 'hash').set(value);
            }
            for (const [key, property] of propertyImages)
                add(key, () => ctx.prop['_' + property]);
            for (const key of translatedImages)
                add(key, () => {
                    const descriptor = runtime.memberSlot(descriptors, NativeString.hostUtf8Bytes(key), 'hash').get() as {
                        altKey?: NativeString;
                    } | undefined;
                    return operations.translate(descriptor?.altKey);
                });
        }
        return runtime.memberSlot(cache, scalarPV(name), 'hash').get() as GeneralModel | undefined;
    }
    return { image, beginRendering(ctx) { caches.delete(ctx); }, callbacks: {
            _get_image: (ctx, name) => image(ctx, name),
            _Image__set_url: (_ctx, img: GeneralModel, value) => img._url = operations.escapeUrl(value),
        } };
}
