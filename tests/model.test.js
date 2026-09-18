const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const Model = require("../Model.js")

const NOW = Date.parse("2026-09-18T09:00:00Z")

function running(seconds, label) {
  return JSON.stringify({
    schema: 1,
    label: label || "5 minutes",
    duration_sec: seconds,
    started_at: "2026-09-18T09:00:00Z",
    ends_at: new Date(NOW + seconds * 1000).toISOString()
  })
}

// ── the document ────────────────────────────────────────────────────────

test("an empty file is an idle timer, not a broken one", () => {
  for (const text of ["", "   ", null, undefined]) {
    assert.equal(Model.parse(text).status, "idle", JSON.stringify(text))
  }
})

test("a document with no end is idle, whatever else it carries", () => {
  // This is what cancelling writes. A zero-byte file would say the same thing
  // and would also be what a failed write leaves behind.
  assert.equal(Model.parse(JSON.stringify({ schema: 1 })).status, "idle")
})

test("a newer schema is refused rather than half-read", () => {
  const snapshot = Model.parse(JSON.stringify({ schema: 99, ends_at: "2026-09-18T09:05:00Z" }))
  assert.equal(snapshot.status, "unsupported")
})

test("a file caught mid-write is a state to show, not an exception to throw", () => {
  const snapshot = Model.parse('{"schema":1,"ends')
  assert.equal(snapshot.status, "unreadable")
  assert.notEqual(snapshot.error, "")
})

test("the state path follows XDG, and expands a tilde someone typed", () => {
  assert.equal(Model.statePath("", "/run/state", "/home/j"), "/run/state/sveglia/timer.json")
  assert.equal(Model.statePath("", "", "/home/j"), "/home/j/.local/state/sveglia/timer.json")
  assert.equal(Model.statePath("~/t.json", "", "/home/j"), "/home/j/t.json")
  assert.equal(Model.statePath("/tmp/t.json", "/run/state", "/home/j"), "/tmp/t.json")
})

// ── the countdown ───────────────────────────────────────────────────────

test("the countdown is m:ss under an hour and h:mm:ss over", () => {
  assert.equal(Model.format(0), "0:00")
  assert.equal(Model.format(9), "0:09")
  assert.equal(Model.format(60), "1:00")
  assert.equal(Model.format(272), "4:32")
  assert.equal(Model.format(3600), "1:00:00")
  assert.equal(Model.format(3725), "1:02:05")
})

test("seconds keep ticking past the hour mark", () => {
  // A number that stops moving is a timer you assume has broken.
  assert.notEqual(Model.format(3661), Model.format(3662))
})

test("a second remaining rounds up, so the bar never shows 0:00 while running", () => {
  const snapshot = Model.parse(running(300))
  const view = Model.view(snapshot, NOW + 299_500)
  assert.equal(view.remaining, 1)
  assert.equal(view.badge, "0:01")
  assert.equal(view.running, true)
})

test("a timer past its end is not running, and leaves the bar", () => {
  // systemd raised the toast; what is left here is a widget that should get
  // out of the way.
  const view = Model.view(Model.parse(running(300)), NOW + 300_001)
  assert.equal(view.running, false)
  assert.equal(view.visible, false)
  assert.equal(view.badge, "")
})

test("nothing counting means nothing in the bar", () => {
  const view = Model.view(Model.idle(), NOW)
  assert.equal(view.visible, false)
  assert.equal(view.badge, "")
  assert.equal(view.running, false)
})

test("the last minute is urgent, and the minute before it is not", () => {
  assert.equal(Model.view(Model.parse(running(300)), NOW + 240_000).urgent, true)
  assert.equal(Model.view(Model.parse(running(300)), NOW + 239_000).urgent, false)
})

// ── what it runs ────────────────────────────────────────────────────────

test("starting hands the alarm to systemd rather than keeping it in the shell", () => {
  // A QML timer would fire once per monitor, because a bar widget is
  // instantiated once per monitor, and would die with the shell.
  const command = Model.startCommand(Model.presetFor("5"))
  assert.match(command, /systemd-run --user --quiet --unit=sveglia-timer --on-active=300 /)
  assert.match(command, /omarchy-notification-send -u critical 'Timer' '5 minutes is up'/)
})

test("starting stops whatever was running first, because --unit refuses a duplicate", () => {
  const command = Model.startCommand(Model.presetFor("1"))
  assert.ok(command.indexOf("systemctl --user stop sveglia-timer.timer") <
    command.indexOf("systemd-run"), command)
})

test("cancelling clears the failed state too, or the next start is refused", () => {
  const command = Model.cancelCommand()
  assert.match(command, /systemctl --user stop sveglia-timer\.timer/)
  assert.match(command, /reset-failed sveglia-timer\.service/)
  // It must not fail when there was nothing to stop: a cancel with no timer
  // running is a normal thing to do.
  assert.match(command, /; true$/)
})

test("everything that reaches a shell is quoted", () => {
  // Asserted by running it. A quoting bug that a string comparison would
  // happily encode into its own expectation is exactly the bug worth
  // catching, so the shell itself is the judge.
  const hostile = ["'; rm -rf ~; echo '", "$(id)", "`id`", 'a\'b"c', "back\\slash"]
  for (const text of hostile) {
    const quoted = Model.shellQuote(text)
    const out = execFileSync("sh", ["-c", "printf %s " + quoted], { encoding: "utf8" })
    assert.equal(out, text, quoted)
  }
})

test("a preset that does not exist runs nothing at all", () => {
  assert.equal(Model.presetFor("7"), null)
  assert.equal(Model.startCommand(null), "")
})

test("the document the widget writes ends when the unit fires", () => {
  const preset = Model.presetFor("25")
  const doc = JSON.parse(Model.startDocument(preset, NOW))
  assert.equal(doc.schema, Model.SCHEMA)
  assert.equal(doc.duration_sec, 1500)
  assert.equal(doc.ends_at, "2026-09-18T09:25:00Z")
  assert.equal(doc.label, "25 minutes")
  // And it parses back as running, which is the round trip that matters.
  assert.equal(Model.parse(Model.startDocument(preset, NOW)).status, "running")
})

// ── the popup ───────────────────────────────────────────────────────────

test("every row knows the command its enter key runs", () => {
  for (const view of [Model.view(Model.idle(), NOW), Model.view(Model.parse(running(300)), NOW)]) {
    for (const row of Model.rows(view)) {
      assert.notEqual(row.command, "", row.kind + " has no command")
    }
  }
})

test("a running timer puts its own cancel at the top", () => {
  const rows = Model.rows(Model.view(Model.parse(running(300)), NOW + 60_000))
  assert.equal(rows[0].kind, "cancel")
  assert.equal(rows[0].section, "RUNNING")
  assert.equal(rows[0].sub, "4:00")
  assert.equal(rows[1].section, "REPLACE WITH")
})

test("with nothing running the presets lead, and say so", () => {
  const rows = Model.rows(Model.view(Model.idle(), NOW))
  assert.equal(rows[0].kind, "preset")
  assert.equal(rows[0].section, "START")
  assert.equal(rows.length, Model.presets().length)
})

// ── the seams ───────────────────────────────────────────────────────────

test("the widget holds no session and reaches no network", () => {
  // sveglia is the one fleet app with no server. Nothing here should ever
  // need one, and this is the test that keeps it that way.
  for (const name of ["Timer.qml", "Countdown.qml", "Model.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8")
    for (const forbidden of ["XMLHttpRequest", "WebSocket", "/api/v1", "access_token", "sal "]) {
      assert.ok(!source.includes(forbidden), name + " must not reference " + forbidden)
    }
  }
})

test("the QML assembles no command by hand", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Timer.qml"), "utf8")
  assert.ok(!/"system(ctl|d-run)/.test(source),
    "Timer.qml is building an argv instead of asking Model.js")
})

test("the widget is declared in the manifest, or the bar cannot load it", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  assert.equal(manifest.id, "saltare.sveglia")
  assert.ok(manifest.kinds.includes("bar-widget"))
  assert.equal(manifest.entryPoints.barWidget, "Timer.qml")
  assert.ok(fs.existsSync(path.join(__dirname, "..", manifest.entryPoints.barWidget)))
})

test("the bar slot collapses to nothing when no timer is running", () => {
  // Without an implicit size the root is 0x0 and the widget draws nothing at
  // all; with an unconditional one it leaves a gap in an idle bar.
  const source = fs.readFileSync(path.join(__dirname, "..", "Timer.qml"), "utf8")
  assert.match(source, /implicitWidth: button\.visible \? button\.implicitWidth : 0/)
  assert.match(source, /implicitHeight: button\.visible \? button\.implicitHeight : 0/)
})

test("the clock only ticks while something is counting", () => {
  // A repeating one-second timer in a bar that is idle all day is a wakeup a
  // laptop pays for.
  const source = fs.readFileSync(path.join(__dirname, "..", "Countdown.qml"), "utf8")
  assert.match(source, /running: root\.view\.running/)
})
