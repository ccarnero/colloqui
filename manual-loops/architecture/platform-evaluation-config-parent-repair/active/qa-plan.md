# Preimplementation QA

Native fp-qa confirmed the existing 14 cases cover the exact two-line repair.
Cases: exact patch and scope; cold absent parent; warm existing parent with prior
sentinel preservation; full source/preservation lifecycle; offline-only completion.
Each suite must report 14 pass/zero failed/skipped/cancelled. Cold creates two
exact sentinel leaves; warm creates two additional leaves and preserves the first
pair. No new test, hook, helper or library is needed. Prior R01 stays exhausted.

QA requested lstat-safe absence checks for all three parent levels; these were
incorporated before implementation/gate dispatch. The recommended warm precheck
now rejects symlink/nonregular sentinels before hashing. QA said no further design
cycle is needed; postimplementation QA must verify the exact two insertions.
No tests or gates were run by QA. One read-only path typo failed and was corrected;
no source was changed and no execution budget was consumed by that read.
