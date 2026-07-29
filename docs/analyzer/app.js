// docs/analyzer/app.js
//
// Build File Analyzer (Phase D1) — page wiring.
// Pipeline: toml -> parseCatalog/resolvePicks -> classifyPicks ->
//           buildLookupInput -> lookup()  [UNCHANGED libs-picker engine] ->
//           buildReport -> render.
//
// DOM contract (index.html must provide these IDs):
//   #loading         data-load state (text swapped on failure)
//   #analyzer-ui     hidden until data is ready
//   #toml-input      textarea: libs.versions.toml
//   #wrapper-input   textarea: optional gradle-wrapper.properties (gradle axis)
//   #gradle-manual   input: manual Gradle version fallback
//   #file-input      hidden <input type="file">
//   #dropzone        drag & drop target (toggles .drag-over)
//   #btn-analyze #btn-sample #btn-export
//   #parse-errors    hard parse failures
//   #summary         report count strip
//   #report          report sections
//   #report-json     <pre> machine-readable export
//
// Rendering uses libs-picker design-token classes (bg-surface, border-border,
// text-textMain, text-textMuted, text-successText, text-errorText, bg-errorBg,
// bg-page). The logic does not depend on them — restyle as you like.

import { buildIndexes, lookup } from "../libs-picker/lookup.js";
import { parseCatalog, resolvePicks, TomlParseError } from "./toml.js";
import { classifyPicks, buildLookupInput, describePick } from "./axis-map.js";
import { buildReport, reportToJSON } from "./report.js";

// Same data sources as libs-picker — single source of truth, no re-scraping.
const GRAPH_URL =
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/compat-graph.json";
const COMPAT_URLS = [
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/agp8/compat.json",
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/agp9/compat.json",
];

let indexes = null;
let lastReport = null;

// Step 2.5 fixture — reproduces combo e90703eb89081e0b (the Coil/Dagger
// misattribution incident). Expected report: hilt axis KNOWN_ISSUE with
// failureSignature hilt_gradle_kotlin_metadata_floor and the CI workflow
// URL — NOT a coil/dagger flag. coil-compose must land in "not tracked".
const SAMPLE_TOML = `# Reproduces the Coil/Dagger misattribution incident (combo e90703eb89081e0b)
[versions]
agp = "8.1.4"
kotlin = "1.9.25"
ksp = "1.9.25-1.0.20"
hilt = "2.58"
coil = "2.6.0"

[libraries]
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }
coil-compose = { group = "io.coil-kt", name = "coil-compose", version.ref = "coil" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
`;
// Gradle never lives in the catalog — the sample pins it via the wrapper,
// exactly where a real project declares it.
const SAMPLE_WRAPPER = `distributionUrl=https\\://services.gradle.org/distributions/gradle-8.0-bin.zip
networkTimeout=10000
validateDistributionUrl=true
`;

async function init() {
  try {
    const [graphResp, compat8Resp, compat9Resp] = await Promise.all([
      fetch(GRAPH_URL),
      fetch(COMPAT_URLS[0]),
      fetch(COMPAT_URLS[1]),
    ]);
    const graph = await graphResp.json();
    const compat8 = await compat8Resp.json();
    const compat9 = await compat9Resp.json();
    const compat = {
      results: [...(compat8.results || []), ...(compat9.results || [])],
    };
    indexes = buildIndexes({ compat, graph });
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("analyzer-ui").classList.remove("hidden");
  } catch (err) {
    document.getElementById("loading").innerText =
      `Failed to load data: ${err.message}`;
    console.error(err);
  }
}

// --- gradle axis (never present in a version catalog) ---------------------

function parseGradleWrapper(text) {
  // distributionUrl=https\://services.gradle.org/distributions/gradle-8.13-bin.zip
  const m = text.match(/gradle-([\d.]+(?:-[\w.-]+)?)-(?:bin|all)\.zip/);
  return m ? m[1] : null;
}

function resolveGradle() {
  const wrapperText = document.getElementById("wrapper-input").value.trim();
  if (wrapperText) {
    const v = parseGradleWrapper(wrapperText);
    if (v) return { version: v, source: "wrapper-properties" };
  }
  const manual = document.getElementById("gradle-manual").value.trim();
  if (manual) return { version: manual, source: "manual" };
  return { version: null, source: null };
}

// --- analysis pipeline -----------------------------------------------------

function analyze() {
  const errBox = document.getElementById("parse-errors");
  errBox.innerHTML = "";
  lastReport = null;

  const tomlText = document.getElementById("toml-input").value.trim();
  if (!tomlText) {
    showFatal(
      "Nothing to analyze — paste a libs.versions.toml or load the sample.",
    );
    return;
  }

  let catalog;
  try {
    catalog = parseCatalog(tomlText);
  } catch (err) {
    if (err instanceof TomlParseError) {
      showFatal(
        `TOML parse failed — ${escapeHtml(err.message)}. Fix or remove that line; the analyzer refuses to guess.`,
      );
      return;
    }
    throw err;
  }

  const { picks, warnings } = resolvePicks(catalog);
  const classified = classifyPicks(picks);
  const { input, conflicts } = buildLookupInput(classified);

  const gradle = resolveGradle();
  if (gradle.version) {
    input.core.gradle = gradle.version;
  } else {
    warnings.push(
      "Gradle version not provided — the gradle axis cannot be checked. " +
        "Paste gradle-wrapper.properties or enter it manually.",
    );
  }

  // Step 2.3: the EXISTING engine, untouched.
  const results = lookup(input, indexes);

  // Attach the versions the engine results don't carry (report display only).
  for (const res of results) {
    if (res.axis === "core") res.coreSnapshot = { ...input.core };
    else res.version = input.libs[res.axis] || "";
  }

  const report = buildReport({
    lookupResults: results,
    classified,
    conflicts,
    parseWarnings: warnings,
    input,
    gradleSource: gradle.source,
  });

  lastReport = report;
  renderReport(report);
}

// --- rendering (functional baseline — visual layer is yours) ---------------

function renderReport(report) {
  renderSummary(report.summary);
  const container = document.getElementById("report");
  container.innerHTML = "";

  const s = report.sections;
  // Deliberate order: actionable first, "all clear" noise last.
  if (s.knownIssues.length) {
    container.appendChild(
      sectionBlock(
        "Known issues",
        "fa-triangle-exclamation",
        "text-errorText",
        s.knownIssues.map(renderKnownIssue),
      ),
    );
  }
  if (report.diagnostics.conflicts.length) {
    container.appendChild(
      sectionBlock(
        "Version conflicts",
        "fa-code-merge",
        "text-errorText",
        report.diagnostics.conflicts.map(renderConflict),
      ),
    );
  }
  if (s.attention.length) {
    container.appendChild(
      sectionBlock(
        "Unverified — low confidence",
        "fa-circle-question",
        "text-textMuted",
        s.attention.map(renderUnverified),
      ),
    );
  }
  if (s.unverified.length) {
    container.appendChild(
      sectionBlock(
        "Unverified",
        "fa-circle-question",
        "text-textMuted",
        s.unverified.map(renderUnverified),
      ),
    );
  }
  if (s.verified.length) {
    container.appendChild(
      sectionBlock(
        "Verified",
        "fa-check-circle",
        "text-successText",
        s.verified.map(renderVerified),
      ),
    );
  }
  if (
    !s.knownIssues.length &&
    !s.attention.length &&
    !s.unverified.length &&
    !s.verified.length
  ) {
    container.innerHTML = `<p class="text-textMuted mt-6">No tracked axes found in this catalog — see diagnostics below.</p>`;
  }

  renderDiagnostics(report.diagnostics, container);
  document.getElementById("report-json").textContent = reportToJSON(report);
}

function renderSummary(sum) {
  const chip = (label, count, cls) =>
    `<span class="inline-flex items-center gap-2 border border-border bg-surface rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider">` +
    `<span class="${cls}">${count}</span><span class="text-textMuted">${label}</span></span>`;
  document.getElementById("summary").innerHTML = [
    chip("known issues", sum.knownIssues, "text-errorText"),
    chip("conflicts", sum.conflicts, "text-errorText"),
    chip("low confidence", sum.needsAttention, "text-textMain"),
    chip("unverified", sum.unverified, "text-textMuted"),
    chip("verified", sum.verified, "text-successText"),
    chip("not tracked", sum.notTracked, "text-textMuted"),
  ].join("");
}

function sectionBlock(title, icon, colorClass, cards) {
  const el = document.createElement("section");
  el.className = "bg-surface border border-border p-5 rounded-xl shadow-sm";
  el.innerHTML =
    `<h2 class="text-lg font-bold text-textMain mb-4 flex items-center gap-2">` +
    `<i class="fas ${icon} ${colorClass}"></i> ${title} ` +
    `<span class="text-textMuted text-sm font-mono font-normal">(${cards.length})</span></h2>` +
    `<div class="flex flex-col gap-3">` +
    cards.join("") +
    `</div>`;
  return el;
}

function axisLabel(f) {
  if (f.axis !== "core") return f.version || "";
  const c = f.coreSnapshot || {};
  return ["agp", "gradle", "kotlin", "ksp"]
    .filter((a) => c[a])
    .map((a) => `${a} ${c[a]}`)
    .join(" · ");
}

function renderKnownIssue(f) {
  return `
  <div class="p-5 rounded-xl border border-errorText bg-surface flex flex-col gap-2">
    <div class="flex items-center gap-3 flex-wrap">
      <i class="fas fa-times-circle text-errorText text-xl"></i>
      <span class="font-bold text-errorText uppercase tracking-wider">Known issue</span>
      <span class="text-textMuted text-xs font-bold uppercase tracking-wider border border-border px-3 py-1 rounded-full bg-page">${f.axis}</span>
      <span class="ml-auto font-mono text-sm text-textMain">${escapeHtml(axisLabel(f))}</span>
    </div>
    ${f.origin ? `<p class="text-xs text-textMuted font-mono">from ${escapeHtml(f.origin)}</p>` : ""}
    <div class="bg-errorBg p-4 rounded-lg border border-errorText">
      <p class="text-sm font-bold text-textMain mb-1">Rule: <span class="text-errorText">${escapeHtml(f.ruleName || "unknown")}</span></p>
      <p class="text-sm text-textMain italic">${escapeHtml(f.ruleNote || "")}</p>
    </div>
    ${f.ruleSource ? `<p class="text-xs text-textMuted"><span class="font-bold">Source:</span> <a class="underline hover:text-textMain transition-colors" href="${f.ruleSource}" target="_blank" rel="noopener">${f.ruleSource}</a></p>` : ""}
  </div>`;
}

function renderUnverified(f) {
  return `
  <div class="p-5 rounded-xl border border-border bg-surface flex flex-col gap-2">
    <div class="flex items-center gap-3 flex-wrap">
      <i class="fas fa-circle-question text-textMuted text-xl"></i>
      <span class="font-bold text-textMuted uppercase tracking-wider">Unverified
        <span class="font-mono text-[10px] normal-case ml-1 bg-page px-1.5 py-0.5 border border-border rounded-md">confidence ${f.confidence}</span>
      </span>
      <span class="text-textMuted text-xs font-bold uppercase tracking-wider border border-border px-3 py-1 rounded-full bg-page">${f.axis}</span>
      <span class="ml-auto font-mono text-sm text-textMain">${escapeHtml(axisLabel(f))}</span>
      ${confidenceSignal(f.confidence)}
    </div>
    ${f.origin ? `<p class="text-xs text-textMuted font-mono">from ${escapeHtml(f.origin)}</p>` : ""}
    ${confidenceDetail(f)}
  </div>`;
}

function renderVerified(f) {
  return `
  <div class="px-5 py-3 rounded-xl border border-border bg-surface flex items-center gap-3">
    <i class="fas fa-check-circle text-successText text-xl"></i>
    <span class="font-bold text-successText uppercase tracking-wider text-sm">Verified</span>
    <span class="text-textMuted text-xs font-bold uppercase tracking-wider border border-border px-3 py-1 rounded-full bg-page">${f.axis}</span>
    <span class="ml-auto font-mono text-sm text-textMain">${escapeHtml(axisLabel(f))}</span>
  </div>`;
}

function renderConflict(c) {
  return `
  <div class="p-4 rounded-xl border border-errorText bg-surface">
    <p class="text-sm font-bold text-textMain"><span class="text-errorText uppercase text-xs tracking-wider">conflict</span> <span class="font-mono">${escapeHtml(c.axis)}</span></p>
    <p class="text-sm text-textMain mt-1">${escapeHtml(c.note)}</p>
    <ul class="text-xs font-mono text-textMuted mt-2 flex flex-col gap-1">
      <li>${escapeHtml(c.picks[0])} → ${escapeHtml(c.versions[0])}</li>
      <li>${escapeHtml(c.picks[1])} → ${escapeHtml(c.versions[1])}</li>
    </ul>
  </div>`;
}

// Mirrors libs-picker/app.js helpers — extract into lookup.js if a third
// consumer ever appears.
function confidenceSignal(conf) {
  const level = conf === "HIGH" ? 3 : conf === "MEDIUM" ? 2 : 1;
  const heights = ["h-2", "h-3", "h-4"];
  let bars = "";
  for (let i = 0; i < 3; i++) {
    const filled = i < level;
    bars += `<span class="w-1.5 ${heights[i]} rounded-[1px] ${filled ? "bg-textMain" : "bg-border"}"></span>`;
  }
  return `<span class="inline-flex items-end gap-0.5" title="confidence: ${conf}">${bars}</span>`;
}

function describeDistance(distance) {
  switch (distance) {
    case "same":
      return "same version, different combo";
    case "patch":
      return "patch-level step from tested";
    case "minor":
      return "minor-level step from tested";
    case "major":
      return "major-level step from tested";
    case "boundary":
      return "across KSP format boundary";
    default:
      return "no tested neighbor";
  }
}

function confidenceDetail(f) {
  let html = "";
  if (f.axis === "core" && f.perAxis) {
    if (f.weakestAxis) {
      const w = f.perAxis[f.weakestAxis];
      html +=
        `<p class="text-sm text-textMain">Weakest link: <span class="font-mono font-bold">${f.weakestAxis}</span>` +
        (w && w.nearest
          ? ` — closest tested is <span class="font-mono font-bold">${w.nearest}</span> (${describeDistance(w.distance)})`
          : "") +
        `</p>`;
    }
    html += `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">`;
    for (const [axis, info] of Object.entries(f.perAxis)) {
      html += `
      <div class="rounded-lg border border-border bg-page px-3 py-2">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-textMuted">${axis}</span>
          ${confidenceSignal(info.confidence)}
        </div>
        <div class="font-mono text-xs font-bold text-textMain mt-1.5 truncate" title="${info.nearest || ""}">${info.nearest || "—"}</div>
        <div class="text-[10px] text-textMuted leading-tight mt-0.5">${describeDistance(info.distance)}</div>
      </div>`;
    }
    html += `</div>`;
  } else {
    html +=
      `<p class="text-sm text-textMain">` +
      (f.nearestVerified
        ? `Closest tested version: <span class="font-mono font-bold">${f.nearestVerified}</span> (${describeDistance(f.nearestDistance)})`
        : "No tested version of this library on record.") +
      `</p>`;
  }
  html += `<p class="text-[11px] text-textMuted italic mt-2">Based on proximity to tested combinations, not a guarantee of compatibility.</p>`;
  return html;
}

const OBSERVED_NOTE =
  "Tracked in CI combos but not evaluated by the lookup engine — it depends on " +
  "compileSdk, which a version catalog cannot express.";

function renderDiagnostics(d, container) {
  const rows = [];

  if (d.parseWarnings.length) {
    rows.push(`<div class="bg-surface border border-border p-5 rounded-xl shadow-sm">
      <p class="text-xs uppercase tracking-wider font-bold text-textMuted mb-3 flex items-center gap-2"><i class="fas fa-triangle-exclamation text-warningText"></i> Parse warnings</p>
      <ul class="flex flex-col gap-1">${d.parseWarnings.map((w) => `<li class="text-xs font-mono text-textMain">• ${escapeHtml(w)}</li>`).join("")}</ul>
    </div>`);
  }

  const coverage =
    `Axes not found in this catalog: <span class="font-mono">${d.missingAxes.length ? d.missingAxes.join(", ") : "none"}</span>. ` +
    `<span class="font-mono">${d.notInCatalog.join(", ")}</span> are modeled by AndroidCompat but cannot be expressed in a version catalog.` +
    (d.gradleSource
      ? ` Gradle taken from: <span class="font-mono">${d.gradleSource}</span>.`
      : "");
  rows.push(`<div class="bg-surface border border-border p-5 rounded-xl shadow-sm">
    <p class="text-xs uppercase tracking-wider font-bold text-textMuted mb-3 flex items-center gap-2"><i class="fas fa-map text-textMuted"></i> Coverage</p>
    <p class="text-sm text-textMain leading-relaxed">${coverage}</p>
  </div>`);
  const infoLists = [
    ["Informational — relevant but not graph axes", d.informational],
    ["Not tracked by AndroidCompat", d.untracked],
    ["Tracked in CI, not evaluated here", d.observed],
  ];
  for (const [title, list] of infoLists) {
    if (!list.length) continue;
    rows.push(`<div class="bg-surface border border-border p-5 rounded-xl shadow-sm">
      <p class="text-xs uppercase tracking-wider font-bold text-textMuted mb-3 flex items-center gap-2">${title} <span class="font-mono font-normal">(${list.length})</span></p>
      <ul class="flex flex-col gap-2">${list
        .map(
          (c) => `
        <li class="p-3 rounded-lg border border-border bg-page">
          <span class="font-mono text-xs text-textMain">${escapeHtml(describePick(c.pick))}${c.pick.version ? ` → ${escapeHtml(c.pick.version)}` : ""}</span>
          <p class="text-xs text-textMuted mt-1">${escapeHtml(c.note || OBSERVED_NOTE)}</p>
        </li>`,
        )
        .join("")}
      </ul>
    </div>`);
  }

  container.appendChild(
    sectionBlock("Diagnostics", "fa-clipboard-list", "text-textMuted", rows),
  );
}

function showFatal(msg) {
  document.getElementById("parse-errors").innerHTML =
    `<div class="p-4 rounded-xl border border-errorText bg-errorBg mt-4">
       <p class="text-sm font-bold text-errorText"><i class="fas fa-times-circle"></i> ${msg}</p>
     </div>`;
  document.getElementById("report").innerHTML = "";
  document.getElementById("summary").innerHTML = "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- input wiring -----------------------------------------------------------

function routeFile(file) {
  return file.text().then((text) => {
    const target = /gradle-wrapper\.properties$/i.test(file.name)
      ? document.getElementById("wrapper-input")
      : document.getElementById("toml-input");
    target.value = text;
  });
}

const dz = document.getElementById("dropzone");
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("drag-over");
});
dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("drag-over");
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) routeFile(file);
});
dz.addEventListener("click", () =>
  document.getElementById("file-input").click(),
);
document.getElementById("file-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) routeFile(file);
});

document.getElementById("btn-sample").addEventListener("click", () => {
  document.getElementById("toml-input").value = SAMPLE_TOML;
  document.getElementById("wrapper-input").value = SAMPLE_WRAPPER;
  document.getElementById("gradle-manual").value = "";
});

document.getElementById("btn-analyze").addEventListener("click", () => {
  if (!indexes) return;
  const btn = document.getElementById("btn-analyze");
  const label = btn.textContent;
  btn.textContent = "Analyzing…";
  btn.disabled = true;
  // let the label paint before the sync pipeline runs
  setTimeout(() => {
    try {
      analyze();
    } finally {
      btn.textContent = label;
      btn.disabled = false;
    }
  }, 30);
});

document.getElementById("btn-export").addEventListener("click", () => {
  if (!lastReport) return;
  const blob = new Blob([reportToJSON(lastReport)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "androidcompat-report.json";
  a.click();
  URL.revokeObjectURL(url);
});

init();
