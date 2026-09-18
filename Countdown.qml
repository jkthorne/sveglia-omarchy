import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// The whole data layer: one file, read and written.
//
// A bar widget is instantiated once per monitor, which is the reason this is a
// file at all rather than a property. Two instances each holding their own
// countdown would disagree about the same timer within a second of it
// starting, and both would draw a number.
//
// The alarm itself is not here. It is a transient systemd user unit, because
// that fires exactly once from one process and outlives the shell — see
// Model.startCommand.
Item {
  id: root
  visible: false

  property var settings: ({})
  property var snapshot: Model.idle()

  // The countdown has to keep moving while nothing changes on disk, so the
  // clock ticks on its own rather than only when the file does.
  property double nowMs: Date.now()

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string statePath: Model.statePath(
    settings ? settings.statePath : "", Quickshell.env("XDG_STATE_HOME"), home)

  readonly property var view: Model.view(snapshot, nowMs)
  readonly property var rows: Model.rows(view)

  signal changed()

  FileView {
    id: file
    path: root.statePath
    watchChanges: true
    printErrors: false
    // atomicWrites keeps the sibling instance from ever observing a
    // half-written document, which is the same bargain the workspace daemon
    // makes with its own readers.
    atomicWrites: true
    onFileChanged: reload()
    onLoaded: {
      root.snapshot = Model.parse(text())
      root.nowMs = Date.now()
      root.changed()
    }
    onLoadFailed: {
      root.snapshot = Model.idle()
      root.changed()
    }
  }

  // One tick a second, and only while something is counting. A repeating timer
  // in a bar that is idle all day is a wakeup a laptop pays for.
  Timer {
    interval: 1000
    running: root.view.running
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  function write(text) {
    file.setText(text)
    root.snapshot = Model.parse(text)
    root.nowMs = Date.now()
    root.changed()
  }

  function start(preset) {
    if (!preset) return
    root.write(Model.startDocument(preset, Date.now()))
  }

  function clear() {
    root.write(Model.idleDocument())
  }
}
