# General Page and Entry assembly

The parent applies the post-context language merge when the worker reports successful
initialization, before selected SQL and Page helpers. Initialization diagnostics skip
that merge. The worker session owns `start_css` and `end_css` on its original native
output session; initialization, resumed preparation and Page printing use one Context
and one sink. No new runtime module or output authority is introduced.

The Recent assembler now connects the reviewed Page and Entry constructors in that
Context. Entry preparation is lazy: feeds precede sticky entries, each normal Entry is
prepared immediately before its display notification, and counted sticky window rows
are skipped before Entry/cleaner/public-helper calls. The full window still contributes
to native navigation counts. The prior API for already prepared models remains usable.

Direct Entry has a distinct source factory from `EntryPage_entry` rather than reusing
Recent's `Entry_from_entryobj`. It constructs separate journal/poster UserLite objects,
uses the poster picture and its picture-id-zero fallback, prepares comment info before
content, and applies reply-mode link flags with native false-scalar semantics. It calls
only the event's external embedding stage, preserves absent caller cut options, leaves
`dom_id` undefined, records the public entry text/tags, and binds currents to the journal.
Recent's shared picture, forced mood theme, internal embedding and adult transform are
not silently applied to direct Entry.

Focused evidence includes actual native source/recovered initialization and rendering,
real closed private-worker Recent/Entry CSS calls, parent request ordering, and retained
native constructor/provider order. The Recent proof now runs actual Page and Entry
constructors after admitted program initialization. The native constructor oracles use
declared fixed public/content providers; empty-content controls do not stand in for an
installed identity cleaner. Separate reviewed constructor proofs retain their own scope.

The complete ordinary worker/factory remains unfinished: original property/event/subject
cleaning, direct Entry head and independent OG, comment preparation/navigation binding,
remaining installed hosts and final native postprocessing still require implementation.
The held subject component is not imported. Mandatory cleaner callbacks remain explicit;
neither final streaming output nor an identity function replaces original cleaning.
This checkpoint does not establish general HTTP or stock/custom compatibility completion.

The outer direct Entry assembler binds the reviewed navigation constructors and their
callbacks through one factory instance. Its trusted permalink closure preserves native
view/page/style query construction and integer coercion. A copied model cannot acquire
its private URL callback. Disabled comments take the empty navigation path before comment
projection, preserving the no-read boundary; independent original-source head/OG remains
a mandatory operation. This is source assembly, not a claim that installed comment cleaning
or the ordinary production worker registry is finished.
