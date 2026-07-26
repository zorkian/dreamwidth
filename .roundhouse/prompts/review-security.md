# Security review instructions

Review concrete changes to trust boundaries, authorization, credentials,
untrusted input handling, network access, and secret exposure. Trace
attacker-controlled data to privileged effects.

Report exploitable defects or meaningful regressions caused by the change. Do
not request generic defense in depth or speculative hardening unrelated to the
diff.
