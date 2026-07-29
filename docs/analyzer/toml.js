// docs/analyzer/toml.js
//
// Minimal TOML-subset parser for Gradle version catalogs (libs.versions.toml).
//
// Scope (deliberate): version catalogs use a small, stable slice of TOML —
// [section] headers, bare/dotted keys, basic strings, inline tables, string
// arrays. This parser implements exactly that slice and fails LOUDLY (with a
// line number) on anything else, so the report can say "line 42 not
// understood" instead of silently dropping a dependency.
// No external dependency — keeps the analyzer fully static.

export class TomlParseError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

export function parseCatalog(text) {
  const root = {};
  let section = root;
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    i++;
    if (line === "") continue;

    const sec = line.match(/^\[([A-Za-z0-9_.\-]+)\]$/);
    if (sec) {
      section = ensurePath(root, sec[1].split("."));
      continue;
    }

    const eq = findTopLevelEquals(line);
    if (eq < 0) {
      throw new TomlParseError(lineNo, `expected "key = value", got: ${line}`);
    }
    const key = cleanKey(line.slice(0, eq));
    let rawVal = line.slice(eq + 1).trim();

    // Multi-line arrays: accumulate until brackets balance.
    if (rawVal.startsWith("[")) {
      while (!bracketsBalanced(rawVal) && i < lines.length) {
        rawVal += " " + stripComment(lines[i]).trim();
        i++;
      }
    }

    setDotted(section, key.split("."), parseValue(rawVal, lineNo));
  }
  return root;
}

// Resolve version.ref indirection and the { module = "g:a" } / "g:a:v"
// shorthands into a flat pick list. Axis assignment is NOT done here —
// see axis-map.js. Returns { picks, warnings }; warnings feed the
// "couldn't interpret" section of the report, never swallowed.
export function resolvePicks(catalog) {
  const versions = catalog.versions || {};
  const picks = [];
  const warnings = [];

  for (const [refName, entry] of Object.entries(catalog.libraries || {})) {
    if (typeof entry === "string") {
      const [group, name, ver] = entry.split(":");
      picks.push({ kind: "library", refName, group, name, version: ver });
      continue;
    }
    const version = resolveVersion(
      entry,
      versions,
      `libraries.${refName}`,
      warnings,
    );
    if (entry.module) {
      const [group, name] = String(entry.module).split(":");
      picks.push({ kind: "library", refName, group, name, version });
    } else if (entry.group && entry.name) {
      picks.push({
        kind: "library",
        refName,
        group: entry.group,
        name: entry.name,
        version,
      });
    } else {
      warnings.push(`libraries.${refName}: unrecognized entry shape, skipped`);
    }
  }

  for (const [refName, entry] of Object.entries(catalog.plugins || {})) {
    if (entry && entry.id) {
      const version = resolveVersion(
        entry,
        versions,
        `plugins.${refName}`,
        warnings,
      );
      picks.push({ kind: "plugin", refName, id: entry.id, version });
    } else {
      warnings.push(`plugins.${refName}: missing "id", skipped`);
    }
  }

  return { picks, warnings };
}

// --- internals -----------------------------------------------------------

function resolveVersion(entry, versions, refName, warnings) {
  if (entry == null || typeof entry !== "object") return undefined;
  let v = entry.version;
  if (v && typeof v === "object" && v.ref) {
    const resolved = versions[v.ref];
    if (typeof resolved !== "string") {
      warnings.push(
        `${refName}: version.ref "${v.ref}" not found in [versions]`,
      );
      return undefined;
    }
    return resolved;
  }
  return typeof v === "string" ? v : undefined;
}

function stripComment(line) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function findTopLevelEquals(line) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "=") return i;
  }
  return -1;
}

function bracketsBalanced(s) {
  let depth = 0,
    inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
  }
  return depth <= 0;
}

function parseValue(raw, lineNo) {
  if (raw.startsWith('"') || raw.startsWith("'"))
    return parseString(raw, lineNo);
  if (raw.startsWith("{")) return parseInlineTable(raw, lineNo);
  if (raw.startsWith("[")) return parseArray(raw, lineNo);
  throw new TomlParseError(
    lineNo,
    `unsupported value (this parser covers the version-catalog TOML subset): ${raw}`,
  );
}

function parseString(raw, lineNo) {
  const q = raw[0];
  let out = "";
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && q === '"') {
      out += raw[i + 1] ?? "";
      i++;
      continue;
    }
    if (c === q) return out;
    out += c;
  }
  throw new TomlParseError(lineNo, "unterminated string");
}

function parseInlineTable(raw, lineNo) {
  if (!raw.endsWith("}")) {
    throw new TomlParseError(lineNo, `unterminated inline table: ${raw}`);
  }
  const inner = raw.slice(1, -1).trim();
  const obj = {};
  if (inner === "") return obj;
  for (const part of splitTopLevel(inner)) {
    const eq = findTopLevelEquals(part);
    if (eq < 0)
      throw new TomlParseError(
        lineNo,
        `bad inline-table entry: ${part.trim()}`,
      );
    const key = cleanKey(part.slice(0, eq));
    const val = part.slice(eq + 1).trim();
    setDotted(obj, key.split("."), parseValue(val, lineNo));
  }
  return obj;
}

function parseArray(raw, lineNo) {
  if (!raw.endsWith("]"))
    throw new TomlParseError(lineNo, `unterminated array: ${raw}`);
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  return splitTopLevel(inner).map((p) => parseValue(p.trim(), lineNo));
}

function splitTopLevel(raw) {
  const parts = [];
  let depth = 0,
    inStr = null,
    cur = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      cur += c;
      if (c === "\\") {
        cur += raw[++i] ?? "";
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
    } else if (c === "[" || c === "{") {
      depth++;
      cur += c;
    } else if (c === "]" || c === "}") {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

function cleanKey(k) {
  return k.trim().replace(/^["']|["']$/g, "");
}

function setDotted(obj, keys, value) {
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    cur[k] ??= {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function ensurePath(root, keys) {
  let cur = root;
  for (const k of keys) {
    cur[k] ??= {};
    cur = cur[k];
  }
  return cur;
}
