# Poll dialog acceptance

Captured locally on 2026-09-22 in the isolated foreman devcontainer after reviewed
poll integration at `6300adc42`. `t/browser/fck-poll.js` opened the actual modern
entry editor and standalone dialog, inserted all five question types across four
polls, edited the selected nonzero-index poll, and switched to HTML without
publishing. The harness restores the original draft body and properties.

`../poll-before/setup.png` records the original BML Setup dialog. `setup.png`
shows the migrated matching state; `questions.png` shows a populated text
question; `html-roundtrip.png` shows the resulting editor HTML state. These
artifacts are local and have not been published.
