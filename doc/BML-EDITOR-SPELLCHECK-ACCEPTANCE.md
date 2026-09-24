# Configured editor spellcheck compatibility

Independent Sol source audit at `b29e99f50`. This ordinary editor feature must
be preserved before legacy form retirement. No deployment setting is inferred;
no external spellchecker process is needed for acceptance.

## Existing contract and native gap

LJ::Web renders action:spellcheck only when SPELLER is configured and saving is
enabled. Both old update and editjournal handlers intercept it before persistence
and call LJ::SpellCheck::check_html. Suggestions appear as generated HTML under
the global entryform.spellchecked heading. An empty result uses the global
entryform.spellcheck.noerrors message. The helper does not alter source body text.
Submitted form fields are retained; update explicitly retains date and RTE state
and uses pageload(0). Legacy edit resets richtext_default from stored prop_used_rte
after copying POST: characterize this editor-switch nuance rather than assume it.

Native new/edit currently have no spellcheck branch or button. Sending this action
to them would enter normal post/edit processing. Do not route legacy spellcheck
POSTs there until an explicit non-persisting branch exists.

## Bounded implementation

Add the configured button to the shared native form and one controller helper
used by new/edit after normal request setup but before conversion/persistence
hooks. Pass submitted body to LJ::SpellCheck and rerender submitted formdata.
Never post/edit, clear drafts, or schedule crossposts on this action. Keep an
explicit result flag separate from the possibly empty result string. Render
trusted helper output with native markup and the existing global labels; do not
copy the old hotcolor or inerr BML macros.

## Finite acceptance

Use local SPELLER plus a stubbed check_html; do not invoke a process.

- Actual new and owned-edit forms omit the button when disabled, show its
  translated label when configured.
- Real rendered-form submission supplies distinct subject/body/tags/location/
  music/userpic/editor/date/backdating/security/comment fields. Assert exact
  retained controls, exact helper body input and visible suggestions/heading.
- Empty helper output shows localized no-errors text without BML or missing-key
  banners. Plain and rich editor states remain distinct.
- Fresh entry count/state and draft state stay unchanged. Crosspost scheduling
  and persistence hooks are not called; any external-account fixture is stubbed.
- Characterize old update/edit behavior first, including the stored-RTE nuance,
  then verify the native actions. Keep old URL compatibility separate from this
  feature addition; no beta or public-route cutover is included here.

## Native insertion and rendering details from independent plan audit

Detect action:spellcheck and validate the existing form token before calling the
checker. Short-circuit before normal body validation, login submission work,
backend conversion, spam/persistence hooks, draft clearing and crosspost scheduling.
Use a shared helper, then only ordinary form reconstruction. Invalid tokens must
not invoke the checker.

Pass an explicit configured-and-editable, non-readonly poster/journal boolean;
module editable flags are not save permission. Add one secondary submit beside
the bottom save control, not duplicated in quick actions. Use absolute global
entryform.spellcheck, entryform.spellchecked and entryform.spellcheck.noerrors.
Construct the helper with spellcommand from SPELLER. Only generated checker HTML
is trusted in a stable result wrapper; no-errors text uses normal text escaping.

A disposable actual RTE browser case must edit current FCK content, click the
rendered spellcheck submit and prove the checker receives synchronized GetXHTML
content and rerender retains rte0/body. HTTP fields alone cannot prove this.
Do not spawn an external checker in acceptance fixtures.
