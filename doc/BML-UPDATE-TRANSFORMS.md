# Legacy update transform and rerender handoff

Audit checkpoint: `7c806d7a08ca69d067ffdfad2162ff273e27ddf1`.

## Retained contract

`htdocs/update.bml` runs `transform_update_$POST{transform}` before deriving any form values. The hook receives mutable, flat `GET` and `POST` hash references. No in-tree implementation exists, but this is an external ABI: preserve the exact dynamic hook name, argument order, mutable references, and once-only invocation.

The following submissions are nonpersisting form responses:

- `transform` makes the request a transform rather than a post. Hook mutations are used when the form is built. Legacy copies subject, body and tags from truthy POST values with GET fallback, retains crosspost fields with POST-before-GET precedence, and specially retains `event_format` and `richtext_default`.
- `showform` and `moreoptsbtn` suppress posting and rerender submitted values.
- Direct `action:preview` on `/update` suppresses posting and rerenders the form. It does not render the preview page; the actual preview contract belongs to the already migrated `/preview/entry` wrapper.
- Configured `action:spellcheck` is a nonpersisting transform. The native spellcheck helper already supplies checked/unavailable output and native form retention.

These old rerender branches do not call `entry_form_decode`, `decode_entry_form`, `spam_check`, success hooks, housekeeping, or persistence. `DW::Entry::Legacy::prepare_entry_form` currently calls the decoder hook, so using it unchanged would add an external hook invocation to every show/preview/more-options rerender. Provide a pure decode/mapping mode which omits only `decode_entry_form`, or an equivalent raw legacy-to-native rerender preparation helper. Keep the existing save preparation default unchanged.

A failed ordinary post with no POST `usejournal` but a community-valued GET query rerenders with the GET journal because the retained renderer uses `POST usejournal || GET usejournal`. `legacy_new_rerender` has the same presentation behavior. Keep this adapter-specific success-versus-retry distinction: successful target resolution remains POST-only, while retry presentation may use GET fallback. Do not change the generic rerender API.

## Smallest safe package

Extend the callable legacy update adapter only; do not register routes or save data.

1. Classify transform/rerender actions before the existing save branch. Snapshot the requested transform action so it cannot accidentally become a save after hook mutation.
2. Flatten request GET and POST using the established repeated-value representation. For `transform`, invoke `LJ::Hooks::run_hooks("transform_update_$name", $legacy_get, $legacy_post)` exactly once, then build rerender values from those same mutated hashes.
3. Prepare canonical/form data without invoking `decode_entry_form`. Preserve raw RTE body, editor mode, metadata, security/custom groups, date/backdating, comments, adult fields, userpic and crosspost controls for ordinary rerenders. Preserve the narrower retained transform fallback rules listed above.
4. Call `legacy_new_rerender` with explicit mutated GET/form data and the native `/entry/new` retry action while preserving the original encoded and repeated query context.
5. For `action:spellcheck`, validate through the already reviewed native spellcheck seam, pass `spellcheck_requested`, and never enter save, spam, housekeeping or crosspost logic. Retain the reviewed behavior that a checker disappearing after form render produces the unavailable response rather than saving.
6. Leave alternate login/authentication recovery and all save, target permission and public routing work outside this package.

## Finite real-form acceptance

Use disposable users and the actual retained `/update` and `/update.bml` forms through test-only callable middleware.

1. `showform`, `moreoptsbtn`, and direct `action:preview`: each returns the parsed native form with exact submitted subject/body, target, security/custom group, date/backdating, tags, location, music, userpic, editor, comment/adult and crosspost selections. Fresh entry count, draft body/properties, and external account state remain unchanged.
2. Assert zero calls to `decode_entry_form`, `spam_check`, success hooks, housekeeping and crosspost scheduling for all rerender-only cases. A normal action in the same process still follows the existing save adapter, proving dispatch isolation.
3. Configured spellcheck: actual rendered control invokes the checker once, shows meaningful suggestion or no-errors output, retains fields and creates no entry. Unavailable checker remains nonpersisting. Reuse existing native spellcheck coverage rather than duplicate its browser fixture.
4. Transform fixture hook: assert exact hook name, same mutable GET/POST references, one invocation, and visible mutations to subject/body/tags plus retained `event_format`, `richtext_default`, journal and crosspost values. Assert the decoder and persistence hook families remain untouched.
5. Query/context: preserve encoded and repeated query arguments in the native action. Prove transformed POST values take precedence, and transformed empty/absent values follow the retained truthy POST then GET fallback where applicable.
6. Sequentially run two distinct transform names and a plain rerender in one process; assert no mutated GET, POST, hook name, form values, or spellcheck result leaks between requests.

This package does not alter `transform_update_*` ABI, add a public route, save an entry, change permissions, or retire `update.bml`.
