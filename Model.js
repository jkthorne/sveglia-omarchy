// Model.js — every decision the sveglia timer makes, as pure functions.
//
// The QML in this repo is a renderer: it watches one file, hands the text to
// parse(), hands the result to view(), and draws what comes back. Keeping the
// logic here is what makes it testable under `node --test`, and Omarchy's QML
// API is young enough that the parts worth protecting from it are the parts
// that decide things.
//
// Nothing here does I/O, reads a clock, or knows what QML is. The clock comes
// in as an argument precisely so a test can move it.

var SCHEMA = 1

// UNIT is the systemd unit a running timer owns. One name, because one timer:
// starting a second replaces the first, which is what a bar timer should do
// and what `--unit` enforces for free.
var UNIT = "sveglia-timer"

// ── the document ────────────────────────────────────────────────────────
//
// The widget owns this file, unlike saltare.workspace's, which a daemon
// writes. It exists for the same reason that one does: a bar widget is
// instantiated once per monitor, and two instances counting down separately
// would disagree about the same timer within a second of starting it.

function idle() {
  return { status: "idle", doc: null, error: "" }
}

function parse(text) {
  if (!text || String(text).trim() === "") return idle()
  var doc
  try {
    doc = JSON.parse(String(text))
  } catch (e) {
    return { status: "unreadable", doc: null, error: String((e && e.message) || e) }
  }
  if (!doc || typeof doc !== "object") return { status: "unreadable", doc: null, error: "not an object" }
  if (doc.schema !== SCHEMA) return { status: "unsupported", doc: doc, error: "schema " + doc.schema }
  if (!doc.ends_at) return idle()
  return { status: "running", doc: doc, error: "" }
}

// statePath mirrors the convention saltare.workspace uses: XDG_STATE_HOME,
// else ~/.local/state. A person typing a path into a settings field will type
// a "~", so it is expanded.
function statePath(setting, xdgStateHome, home) {
  var configured = String(setting || "").trim()
  if (configured !== "") {
    if (configured.indexOf("~/") === 0) return String(home || "") + configured.slice(1)
    return configured
  }
  var base = String(xdgStateHome || "").trim()
  if (base === "") base = String(home || "") + "/.local/state"
  return base + "/sveglia/timer.json"
}

// ── the grammar of a timer ──────────────────────────────────────────────

// PRESETS are the durations worth one keystroke. The set is short on purpose:
// a list you scroll is a list you could have typed into, and this is a bar
// popup rather than a clock app — sveglia on the phone is where the four
// timer slots and the bedtime schedule live.
var PRESETS = [
  { key: "1", label: "1 minute", seconds: 60 },
  { key: "3", label: "3 minutes", seconds: 180 },
  { key: "5", label: "5 minutes", seconds: 300 },
  { key: "10", label: "10 minutes", seconds: 600 },
  { key: "25", label: "25 minutes", seconds: 1500 },
  { key: "60", label: "1 hour", seconds: 3600 }
]

function presets() {
  return PRESETS.slice()
}

function presetFor(key) {
  for (var i = 0; i < PRESETS.length; i++) {
    if (PRESETS[i].key === String(key)) return PRESETS[i]
  }
  return null
}

// ── the view ────────────────────────────────────────────────────────────

function view(snapshot, nowMs) {
  var doc = (snapshot && snapshot.doc) || null
  var running = snapshot && snapshot.status === "running" && doc
  var remaining = running ? remainingSeconds(doc, nowMs) : 0

  return {
    // A timer past its end is not a running timer. systemd raised the toast;
    // what is left here is a widget that should get out of the bar.
    running: !!running && remaining > 0,
    remaining: remaining,
    label: running ? String(doc.label || "") : "",
    duration: running ? number(doc.duration_sec, 0) : 0,
    // Nothing in the bar when nothing is counting. A timer widget that is
    // always visible is a widget that is always lying about being busy.
    visible: !!running && remaining > 0,
    badge: running && remaining > 0 ? format(remaining) : "",
    // Under a minute it is worth looking at rather than glancing at.
    urgent: !!running && remaining > 0 && remaining <= 60,
    error: (snapshot && snapshot.error) || ""
  }
}

function remainingSeconds(doc, nowMs) {
  var ends = Date.parse(doc && doc.ends_at)
  if (isNaN(ends)) return 0
  return Math.max(0, Math.ceil((ends - nowMs) / 1000))
}

// format is the countdown as a bar shows it: m:ss under an hour, h:mm:ss over.
// Seconds are kept past the hour mark because a timer that stops moving is a
// timer you assume has broken.
function format(seconds) {
  var total = Math.max(0, Math.floor(number(seconds, 0)))
  var h = Math.floor(total / 3600)
  var m = Math.floor((total % 3600) / 60)
  var s = total % 60
  if (h > 0) return h + ":" + pad(m) + ":" + pad(s)
  return m + ":" + pad(s)
}

function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

// rows flattens the popup into one navigable list, the same shape
// saltare.workspace uses — and under the same rule: every row runs a command.
function rows(v) {
  var out = []
  if (v && v.running) {
    out.push({
      kind: "cancel",
      section: "RUNNING",
      label: v.label || "Timer",
      sub: format(v.remaining),
      urgent: v.urgent,
      command: cancelCommand()
    })
  }
  for (var i = 0; i < PRESETS.length; i++) {
    out.push({
      kind: "preset",
      section: i === 0 ? (v && v.running ? "REPLACE WITH" : "START") : "",
      label: PRESETS[i].label,
      sub: PRESETS[i].key + "m",
      key: PRESETS[i].key,
      seconds: PRESETS[i].seconds,
      command: startCommand(PRESETS[i])
    })
  }
  return out
}

// ── what the widget runs ────────────────────────────────────────────────

// startCommand hands the alarm to systemd rather than keeping it in the shell.
//
// That is the whole design. A QML timer would have to survive
// omarchy-restart-shell, would fire once per monitor because a bar widget is
// instantiated once per monitor, and would need a guard against both. A
// transient user unit fires exactly once, from one process, and outlives the
// shell — so the widget is left doing what a widget is for, which is drawing
// the number.
function startCommand(preset) {
  if (!preset) return ""
  var headline = shellQuote(preset.label + " is up")
  return "systemctl --user stop " + UNIT + ".timer >/dev/null 2>&1; " +
    "systemd-run --user --quiet --unit=" + UNIT +
    " --on-active=" + Math.floor(preset.seconds) +
    " omarchy-notification-send -u critical " + shellQuote("Timer") + " " + headline
}

function cancelCommand() {
  return "systemctl --user stop " + UNIT + ".timer >/dev/null 2>&1; " +
    "systemctl --user reset-failed " + UNIT + ".service >/dev/null 2>&1; true"
}

// startDocument is the file the widget writes beside that unit. systemd owns
// the alarm; this owns the countdown, and the two are written together so a
// bar with a number on it always has a unit behind it.
function startDocument(preset, nowMs) {
  var started = new Date(nowMs)
  var ends = new Date(nowMs + preset.seconds * 1000)
  return JSON.stringify({
    schema: SCHEMA,
    label: preset.label,
    duration_sec: preset.seconds,
    started_at: iso(started),
    ends_at: iso(ends)
  }, null, 2) + "\n"
}

// idleDocument is what cancelling writes. An empty object rather than an empty
// file: a zero-byte file is also what a failed write leaves behind.
function idleDocument() {
  return JSON.stringify({ schema: SCHEMA }, null, 2) + "\n"
}

function iso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

// shellQuote exists because a label reaches a shell. These labels are ours
// today; "ours today" is how a command injection gets written.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function number(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

if (typeof module !== "undefined") {
  module.exports = {
    SCHEMA: SCHEMA,
    UNIT: UNIT,
    idle: idle,
    parse: parse,
    statePath: statePath,
    presets: presets,
    presetFor: presetFor,
    view: view,
    rows: rows,
    format: format,
    remainingSeconds: remainingSeconds,
    startCommand: startCommand,
    cancelCommand: cancelCommand,
    startDocument: startDocument,
    idleDocument: idleDocument,
    shellQuote: shellQuote
  }
}
