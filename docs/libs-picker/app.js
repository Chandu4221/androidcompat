import { buildIndexes, lookup, constraintsForNode } from "./lookup.js";

const GRAPH_URL =
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/compat-graph.json";
const COMPAT_URLS = [
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/agp8/compat.json",
  "https://raw.githubusercontent.com/Chandu4221/androidcompat/main/docs/data/agp9/compat.json",
];

let indexes = null;
let graphData = null; // Keep graph data in memory for dropdowns

async function init() {
  try {
    const [graphResp, compat8Resp, compat9Resp] = await Promise.all([
      fetch(GRAPH_URL),
      fetch(COMPAT_URLS[0]),
      fetch(COMPAT_URLS[1]),
    ]);

    graphData = await graphResp.json();
    const compat8 = await compat8Resp.json();
    const compat9 = await compat9Resp.json();

    const compat = {
      results: [...(compat8.results || []), ...(compat9.results || [])],
    };

    indexes = buildIndexes({ compat, graph: graphData });

    // Pass graphData to populateDropdowns (STEP 1 FIX)
    populateDropdowns(graphData);

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("picker-ui").classList.remove("hidden");
  } catch (err) {
    document.getElementById("loading").innerText =
      `Failed to load data: ${err.message}`;
    console.error(err);
  }
}

function populateDropdowns(graph) {
  // STEP 1 FIX: Pull values from graph.nodes instead of compat.results
  const getVersionsFromGraph = (nodeType) => {
    const set = new Set();
    for (const node of Object.values(graph.nodes)) {
      if (node.type === nodeType) set.add(node.version);
    }
    return Array.from(set).sort();
  };

  fillSelect("sel-agp", getVersionsFromGraph("agp"));
  fillSelect("sel-gradle", getVersionsFromGraph("gradle"));
  fillSelect("sel-kotlin", getVersionsFromGraph("kotlin"));
  fillSelect("sel-ksp", getVersionsFromGraph("ksp"));

  fillSelect("sel-hilt", getVersionsFromGraph("hilt"), true);
  fillSelect("sel-room", getVersionsFromGraph("room"), true);
  fillSelect("sel-compose", getVersionsFromGraph("compose"), true);
  fillSelect("sel-navigation", getVersionsFromGraph("navigation"), true);
}

function fillSelect(id, versions, isOptional = false) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  if (isOptional) {
    sel.innerHTML += `<option value="">None</option>`;
  }
  for (const v of versions) {
    sel.innerHTML += `<option value="${v}">${v}</option>`;
  }
}

document.getElementById("btn-check").addEventListener("click", () => {
  if (!indexes) return;

  const input = {
    core: {
      agp: document.getElementById("sel-agp").value,
      gradle: document.getElementById("sel-gradle").value,
      kotlin: document.getElementById("sel-kotlin").value,
      ksp: document.getElementById("sel-ksp").value,
    },
    libs: {},
  };

  const hilt = document.getElementById("sel-hilt").value;
  if (hilt) input.libs.hilt = hilt;

  const room = document.getElementById("sel-room").value;
  if (room) input.libs.room = room;

  const compose = document.getElementById("sel-compose").value;
  if (compose) input.libs.compose = compose;

  const nav = document.getElementById("sel-navigation").value;
  if (nav) input.libs.navigation = nav;

  const results = lookup(input, indexes);
  console.log(JSON.stringify(results, null, 2));
  renderResults(results);
});

for (const libName of ["hilt", "room", "compose", "navigation"]) {
  document
    .getElementById(`sel-${libName}`)
    .addEventListener("change", updateHints);
}

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

function renderConfidence(res) {
  let html = '<div class="mt-3 flex flex-col gap-2">';

  if (res.axis === "core" && res.perAxis) {
    if (res.weakestAxis) {
      const w = res.perAxis[res.weakestAxis];
      html += `<p class="text-sm text-textMain">
        Weakest link: <span class="font-mono text-textMain font-bold">${res.weakestAxis}</span>
        ${w && w.nearest ? `— closest tested is <span class="font-mono text-textMain font-bold">${w.nearest}</span> (${describeDistance(w.distance)})` : ""}
      </p>`;
    }
    html += '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">';
    for (const [axis, info] of Object.entries(res.perAxis)) {
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
    html += "</div>";
  } else {
    html += `<p class="text-sm text-textMain">
      ${
        res.nearestVerified
          ? `Closest tested version: <span class="font-mono text-textMain font-bold">${res.nearestVerified}</span> (${describeDistance(res.nearestDistance)})`
          : "No tested version of this library on record."
      }
    </p>`;
  }

  html += `<p class="text-[11px] text-textMuted italic mt-2">Based on proximity to tested combinations, not a guarantee of compatibility.</p>`;
  html += "</div>";
  return html;
}

function updateHints() {
  const container = document.getElementById("hints-container");
  if (container) container.innerHTML = "";
  if (!indexes) return;

  const byAxis = { agp: [], gradle: [], kotlin: [], ksp: [] };
  let hasHints = false;
  for (const libName of ["hilt", "room", "compose", "navigation"]) {
    const ver = document.getElementById(`sel-${libName}`).value;
    if (!ver) continue;
    for (const c of constraintsForNode(`${libName}:${ver}`, indexes)) {
      byAxis[c.axis].push({ ...c, lib: libName, libVer: ver });
      hasHints = true;
    }
  }

  if (!hasHints || !container) return;

  const alertDiv = document.createElement("div");
  alertDiv.className = "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg p-4";
  let content = '<div class="text-xs uppercase tracking-wider font-bold text-blue-800 dark:text-blue-300 mb-2.5 flex items-center gap-1.5"><i class="fas fa-info-circle"></i> Hints & Requirements</div><ul class="list-disc pl-5 flex flex-col gap-1.5 marker:text-blue-400 dark:marker:text-blue-500">';

  for (const [axis, list] of Object.entries(byAxis)) {
    for (const c of list) {
      const op = c.kind === "pin" ? "=" : "≥";
      content += `<li class="text-[11.5px] text-blue-900 dark:text-blue-200 font-mono pl-1"><strong class="text-blue-950 dark:text-blue-100 capitalize font-sans">${c.lib}</strong> ${c.libVer} requires <strong class="uppercase text-blue-950 dark:text-blue-100 font-sans">${axis}</strong> ${op} <strong class="text-blue-950 dark:text-blue-100">${c.version}</strong></li>`;
    }
  }
  content += "</ul>";
  alertDiv.innerHTML = content;
  container.appendChild(alertDiv);
}

function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML =
    '<h2 class="text-xl font-bold text-textMain flex items-center gap-2 mt-4"><i class="fas fa-stethoscope text-android"></i> Diagnostic Results</h2>';

  for (const res of results) {
    let textColor = "text-textMain";
    let statusColor = "text-textMuted";
    let icon = '<i class="fas fa-circle-question text-textMuted text-xl"></i>';

    if (res.status === "VERIFIED") {
      statusColor = "text-successText";
      icon = '<i class="fas fa-check-circle text-successText text-xl"></i>';
    } else if (res.status === "KNOWN_ISSUE") {
      statusColor = "text-errorText";
      icon = '<i class="fas fa-times-circle text-errorText text-xl"></i>';
    } else if (res.status === "UNVERIFIED") {
      statusColor = "text-textMuted";
      icon = '<i class="fas fa-circle-question text-textMuted text-xl"></i>';
    }

    const div = document.createElement("div");
    div.className = `p-5 rounded-xl border border-border shadow-md bg-surface flex flex-col gap-3`;

    let detail = "";
    if (res.status === "KNOWN_ISSUE" && res.ruleNote) {
      detail = `
        <div class="mt-2 bg-errorBg p-4 rounded-lg border border-errorText">
          <p class="text-sm font-bold text-textMain mb-1">Rule: <span class="font-bold text-errorText">${res.ruleName || "Unknown"}</span></p>
          <p class="text-sm text-textMain italic">${res.ruleNote}</p>
        </div>
      `;
      if (res.ruleSource) {
        detail += `<p class="text-xs text-textMuted mt-2 ml-1"><span class="font-bold">Source:</span> <a href="${res.ruleSource}" target="_blank" rel="noopener" class="underline hover:text-textMain transition-colors">${res.ruleSource}</a></p>`;
      }
    } else if (res.status === "UNVERIFIED" && res.confidence) {
      detail = renderConfidence(res);
    }

    const statusLabel =
      res.status === "UNVERIFIED" && res.confidence
        ? `UNVERIFIED <span class="font-mono text-[10px] text-textMuted normal-case ml-1 font-medium bg-page px-1.5 py-0.5 border border-border rounded-md">confidence ${res.confidence}</span>`
        : res.status;

    div.innerHTML = `
      <div class="flex items-center gap-3">
        ${icon}
        <span class="font-bold ${statusColor} uppercase tracking-wider flex items-center">${statusLabel}</span>
        <span class="text-textMuted text-xs font-bold uppercase tracking-wider border border-border px-3 py-1 rounded-full bg-page shadow-sm">
          ${res.axis}
        </span>
        ${res.status === "UNVERIFIED" && res.confidence ? `<span class="ml-auto flex items-center h-full pt-1">${confidenceSignal(res.confidence)}</span>` : ""}
      </div>
      ${detail}
    `;
    container.appendChild(div);
  }
}
init();
