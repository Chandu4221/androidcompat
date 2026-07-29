// docs/analyzer/report.js
//
// Assembles the analyzer report (step 2.4). Section ORDER is the product
// decision: actionable findings first, "all clear" noise last.
//   1. KNOWN ISSUES   — sourced, high-confidence, fixable today
//   2. LOW-confidence UNVERIFIED — worth a human look before shipping
//   3. remaining UNVERIFIED      — informational
//   4. VERIFIED                  — confirmation only
// Diagnostics (conflicts, parse warnings, untracked/informational deps,
// missing axes) ride alongside — honesty over a clean-looking score.

import { missingAxes } from "./axis-map.js";

export function buildReport({
  lookupResults,
  classified,
  conflicts,
  parseWarnings,
  input,
  gradleSource,
}) {
  const knownIssues = [];
  const attention = []; // UNVERIFIED + LOW
  const unverified = []; // UNVERIFIED + MEDIUM/HIGH
  const verified = [];

  for (const res of lookupResults) {
    const finding = { ...res, origin: originFor(res.axis, classified) };
    if (res.status === "KNOWN_ISSUE") knownIssues.push(finding);
    else if (res.status === "VERIFIED") verified.push(finding);
    else if (res.confidence === "LOW") attention.push(finding);
    else unverified.push(finding);
  }

  const informational = classified.filter((c) => c.bucket === "informational");
  const untracked = classified.filter((c) => c.bucket === "untracked");
  const observed = classified.filter((c) => c.bucket === "observed");

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      knownIssues: knownIssues.length,
      needsAttention: attention.length,
      unverified: unverified.length,
      verified: verified.length,
      notTracked: untracked.length,
      conflicts: conflicts.length,
    },
    sections: { knownIssues, attention, unverified, verified },
    diagnostics: {
      conflicts,
      parseWarnings,
      informational,
      untracked,
      observed,
      missingAxes: missingAxes(input.core, input.libs),
      // gradle never appears in a version catalog — record where it came from
      // ("wrapper-properties" | "manual" | null) so the report is auditable.
      gradleSource: gradleSource || null,
      notInCatalog: ["jdk", "compileSdk", "r8"], // modeled axes a toml cannot express
    },
  };
}

// Traceability: which toml entry produced this axis finding.
function originFor(axis, classified) {
  const c = classified.find(
    (x) => x.axis === axis && (x.bucket === "core" || x.bucket === "library"),
  );
  if (!c) return null;
  return c.pick.kind === "plugin"
    ? `plugins.${c.pick.refName} — ${c.pick.id}`
    : `libraries.${c.pick.refName} — ${c.pick.group}:${c.pick.name}`;
}

// Stable machine-readable export (for the Tier A PR bot later — same shape).
export function reportToJSON(report) {
  return JSON.stringify(report, null, 2);
}
