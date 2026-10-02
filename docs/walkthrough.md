# Walkthrough video script (about 8 minutes)

**0:00–0:40 — The problem.** Engineers need current, cited evidence, and they need conflicts and gaps made visible. Say this build uses evidence rules plus lexical retrieval; a model is optional and not connected. The rule: a confident answer to the wrong item is worse than "cannot be verified".

**0:40–1:50 — Document register.** Show the seven documents. Open the note under Structural · current: package Rev E and its date come from the STR000 register, every title block matches, and the filename label only confirms it. Explain that STR202, STR262 and STR291 are sheet Rev D inside current package Rev E. Open STR000 and show the fingerprint.

**1:50–2:40 — A precise answer.** Ask the suspended-slab question. Show 32 MPa U.O.N., the exact STR001 schedule row and the STR500 note. Open the source page.

**2:40–3:30 — Rewording test.** Ask "What concrete strength is used for the slab on ground?" → 25 MPa. Ask "What is the slab concrete strength?" → Clarify, with both values. Ask "What is the concrete strength for columns?" → cannot be verified. Explain the subject-specific routing.

**3:30–4:20 — Revisions.** Ask the wall-system change question: STR500 legend Dincel → Ritek, and 16 wall-schedule entries across six sheets. Point out that some walls were already Ritek. Ask the suspended slab question "in the old revision" to show a labelled historical answer.

**4:20–5:20 — Conflicts and gaps.** Open the GW1 finding: 200 mm vs 150 mm in the current set, and the same split in Rev D. Show the GW2 "N12-00" and 2W2 reinforcement findings. Ask the Ritek capacity question and show the list of evidence to request. Show the certificate findings: later geotechnical date and no issue date.

**5:20–6:30 — Engineer review.** On GW1: start Engineer Review with a note, then choose Needs Correction with a reason. Reload and show the decision history. Explain the version check, the evidence snapshot and the "evidence changed" flag. Accepting a finding is not design approval.

**6:30–7:30 — Architecture and hallucination control.** Show `docs/architecture.md`. Explain: citations only from page records; abstain by default; the model would only see retrieved excerpts, and its output is rejected for unknown citations or numbers not in the evidence. Run all eight questions and export.

**7:30–8:00 — Limits and next steps.** No OCR or geometry comparison, checks tuned to this pack, model step not live-tested. Next: upload with versioned ingestion, hybrid retrieval with evaluation on unseen projects, claim-level checks for model output, project permissions.
