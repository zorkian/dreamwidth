# Legacy edit action selection boundary

This is a pure classifier for the retained item-bearing `editjournal` POST
contract. It does not invoke a handler, authenticate, validate CSRF, decode an
entry form, schedule crossposts, or mutate an entry.

## Source precedence

`htdocs/editjournal.bml` first treats a nonempty `submit_value` as a submitted
field name. It then evaluates actions in this effective order:

1. `action:savemaintainer` takes the property-only branch only when
   `!$disabled_spamdelete`; otherwise evaluation falls through.
2. A configured `action:spellcheck` computes a transform and suppresses the
   generic save/delete branch.
3. The generic branch runs for `action:save`, `action:delete`, or
   `action:deletespam`; delete behavior wins when either delete action is
   present, and deletespam additionally marks spam.

`action:preview` is not an editjournal dispatch action. An unknown or absent
action reaches no mutation branch.

## API

`DW::Entry::Legacy::legacy_edit_action( $post, spellcheck_enabled => $bool,
maintainer_enabled => $bool )`

The helper accepts a legacy plain hash or converts a `Hash::MultiValue` with
the existing NUL-joining boundary. It returns one of `savemaintainer`,
`spellcheck`, `deletespam`, `delete`, `save`, or `undef` for a nonmutating
classification. It only synthesizes a field from `submit_value` when the
entire scalar is exactly one of those five known `action:*` field names.
NUL-joined, empty, preview, and unknown values never synthesize an action.
`maintainer_enabled` is deliberately supplied by the caller from the existing
`!$disabled_spamdelete` decision; the helper does not infer authorization.

## Finite tests

1. Each real rendered action field is recognized; no action, preview, and
   unknown fields return `undef`.
2. Multiple real fields follow source order: eligible maintainer, configured
   spellcheck, deletespam, delete, save. An ineligible maintainer and disabled
   spellchecker both fall through to the next applicable action.
3. Exact `submit_value` names synthesize only a known action; unknown, empty,
   and NUL-repeated values do not. A valid synthetic action participates in
   the same old precedence as a real field.
4. Plain and multivalue inputs are not mutated, and this helper never reaches
   the decoder-hook boundary.
