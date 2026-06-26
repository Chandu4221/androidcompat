// score-confidence.js
// Phase C - Per-Combo Confidence Scoring
// Calculates a confidence score (0-100) for each compatibility combination

/**
 * Scoring breakdown (max 100):
 *
 * Verification stages (60 pts max):
 *   +20 — sync passed
 *   +20 — compile passed
 *   +20 — unit test passed
 *
 * Failure intelligence (25 pts max):
 *   +25 — no failure signature (clean run)
 *   +10 — failure signature is known (we understand why it broke)
 *    +0 — failure signature is unknown (can't explain the failure)
 *
 * Result consistency (15 pts max):
 *   +15 — status is "verified" (all stages green)
 *   +05 — status is "partial" (compiled but no tests)
 *    +0 — any broken_* status
 */

const LEVELS = [
  { min: 71, max: 100, level: "high" },
  { min: 31, max: 70, level: "medium" },
  { min: 0, max: 30, level: "low" },
];

/**
 * Calculates confidence score for a single combo entry.
 * @param {object} entry - a single combination entry from compat.json
 * @returns {object} confidence block
 */
function scoreConfidence(entry) {
  const factors = [];
  let score = 0;

  const { verification, status, failure_analysis } = entry;

  // ── Verification stages ───────────────────────────────────────────────────

  if (verification?.sync === "success") {
    score += 20;
    factors.push("sync_passed");
  }

  if (verification?.compile === "success") {
    score += 20;
    factors.push("compile_passed");
  }

  if (verification?.unit_test === "success") {
    score += 20;
    factors.push("unit_test_passed");
  }

  // ── Failure intelligence ──────────────────────────────────────────────────

  if (!failure_analysis || failure_analysis === null) {
    // No failure at all — clean run
    score += 25;
    factors.push("no_failure_signature");
  } else if (
    failure_analysis.signature &&
    failure_analysis.signature !== "unknown"
  ) {
    // Known failure — we understand why it broke
    score += 10;
    factors.push("known_failure_signature");
  } else {
    // Unknown failure — can't explain it
    factors.push("unknown_failure_signature");
  }

  // ── Result consistency ────────────────────────────────────────────────────

  if (status === "verified") {
    score += 15;
    factors.push("fully_verified");
  } else if (status === "partial") {
    score += 5;
    factors.push("partially_verified");
  } else {
    factors.push(`broken_status:${status}`);
  }

  // ── Determine level ───────────────────────────────────────────────────────

  const level =
    LEVELS.find((l) => score >= l.min && score <= l.max)?.level || "low";

  return {
    score,
    level,
    factors,
  };
}

module.exports = { scoreConfidence };
