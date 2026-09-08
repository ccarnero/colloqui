# T04 attempt1 QA blocker

QA found T04-implementation.md quotes T02 HANDOFF NOTE Accept instead of T01
For humans Accept. QA otherwise reported all9cases passed, no edits/gates.
Principal then observed the annotation is between **Accept** and the opening
fence, not after its closing fence as required. This contradicts QA placement
case3 despite its pass report. Both defects require pre-gate correction.
No gate has run. Preserve this attempt and correct on attempt2. The principal
extraction assumed adjacent heading/fence and selected T02 after the misplaced
annotation; source selection must be scoped explicitly to T01.
