import { buildIndexes, lookup } from "./lookup.js";

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
  renderResults(results);
});

function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML =
    '<h2 class="text-xl font-bold text-textMain flex items-center gap-2 mt-4"><i class="fas fa-stethoscope text-android"></i> Diagnostic Results</h2>';

  for (const res of results) {
    let bgColor = "bg-surface border-border";
    let textColor = "text-textMain";
    let statusColor = "text-textMuted";
    let icon = '<i class="fas fa-circle-question text-textMuted text-xl"></i>';

    if (res.status === "VERIFIED") {
      textColor = "text-textMain";
      statusColor = "text-successText";
      icon = '<i class="fas fa-check-circle text-successText text-xl"></i>';
    } else if (res.status === "KNOWN_ISSUE") {
      textColor = "text-textMain";
      statusColor = "text-errorText";
      icon = '<i class="fas fa-times-circle text-errorText text-xl"></i>';
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
        detail += `<p class="text-xs text-textMuted mt-2 ml-1"><span class="font-bold">Source:</span> <a href="${res.ruleSource}" target="_blank" class="underline hover:text-textMain transition-colors">${res.ruleSource}</a></p>`;
      }
    }

    div.innerHTML = `
      <div class="flex items-center gap-3">
        ${icon}
        <span class="font-bold ${statusColor} uppercase tracking-wider">${res.status}</span>
        <span class="text-textMuted text-xs font-bold uppercase tracking-wider border border-border px-3 py-1 rounded-full bg-page shadow-sm">${res.axis}</span>
      </div>
      ${detail}
    `;
    container.appendChild(div);
  }
}

init();
