# Data review instructions

Review concrete changes to persisted state, schemas, migrations, data
integrity, and state transitions. Check that writers and readers agree and
that migrations match the intended behavior.

Pay particular attention to lost, duplicated, or partially applied changes.
Report issues caused by the diff rather than generalized recovery or retention
machinery.
