import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The bar button and its popup.
//
// Colours come from the host's theme, not from sveglia's. A bar widget that
// paints itself in its own brand inside someone else's palette is the one they
// uninstall in a week; the saltare visual language belongs in surfaces that
// own the whole screen — which a bar slot is not.
Panel {
  id: root
  moduleName: "saltare.sveglia"
  ipcTarget: "sveglia"

  // The bar allocates a slot from the widget root's implicit size. Without
  // these the root is 0x0 and the widget loads perfectly and draws nothing.
  // Collapsing to zero when nothing is running is the point of the widget:
  // a timer you can see is one that is counting.
  implicitWidth: button.visible ? button.implicitWidth : 0
  implicitHeight: button.visible ? button.implicitHeight : 0

  readonly property var view: countdown.view
  readonly property var rows: countdown.rows

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color barMark: view.urgent
    ? (bar ? bar.urgent : Color.urgent)
    : barForeground

  property int cursor: 0
  property bool cursorActive: false

  function clampCursor() {
    if (rows.length === 0) { cursor = 0; return }
    if (cursor >= rows.length) cursor = rows.length - 1
    if (cursor < 0) cursor = 0
  }

  function moveCursor(dx, dy) {
    if (dy === 0 || rows.length === 0) return
    cursor = (cursor + dy + rows.length) % rows.length
  }

  function run(command) {
    if (!command || command === "") return
    launcher.command = ["sh", "-c", command]
    launcher.running = true
  }

  // Two effects, one order, and the order is the argument: the unit is
  // scheduled before the countdown is written, so a failure leaves a bar with
  // no number rather than a number with no alarm behind it.
  function startPreset(preset) {
    if (!preset) return
    run(Model.startCommand(preset))
    countdown.start(preset)
    close()
  }

  function cancel() {
    run(Model.cancelCommand())
    countdown.clear()
    close()
  }

  function activate() {
    clampCursor()
    if (rows.length === 0) return
    var row = rows[cursor]
    if (row.kind === "cancel") cancel()
    else startPreset(Model.presetFor(row.key))
  }

  Countdown {
    id: countdown
    settings: root.settings
    onChanged: root.clampCursor()
  }

  Process { id: launcher }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    visible: root.view.visible
    iconComponent: Component {
      Item {
        Row {
          anchors.centerIn: parent
          spacing: Style.space(4)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "⏱"
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            color: root.barMark
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            visible: root.view.badge !== ""
            text: root.view.badge
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            color: root.barMark
          }
        }
      }
    }
    onPressed: function(buttonCode) {
      // Right-click cancels without opening anything. Stopping a timer is the
      // one thing you want to do in a hurry, and a popup is in the way of it.
      if (buttonCode === Qt.RightButton) root.cancel()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(480))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dx, dy)
      }
      onActivateRequested: if (root.cursorActive) root.activate()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "x" || t === "X") root.cancel()
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(10)

          PanelHero {
            width: parent.width
            title: root.view.running ? Model.format(root.view.remaining) : "Sveglia"
            meta: root.view.running ? root.view.label : "Nothing is counting"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Repeater {
            model: root.rows

            Item {
              id: rowItem
              required property int index
              required property var modelData
              width: column.width
              implicitHeight: rowBody.implicitHeight
                + (modelData.section !== "" ? heading.implicitHeight + Style.space(6) : 0)

              PanelSectionHeader {
                id: heading
                width: parent.width
                visible: modelData.section !== ""
                text: modelData.section
              }

              Item {
                id: rowBody
                width: parent.width
                anchors.top: modelData.section !== "" ? heading.bottom : parent.top
                anchors.topMargin: modelData.section !== "" ? Style.space(6) : 0
                implicitHeight: label.implicitHeight + Style.space(8)

                Rectangle {
                  anchors.fill: parent
                  radius: Style.cornerRadius
                  color: root.cursorActive && root.cursor === rowItem.index
                    ? Color.menu.selectedBackground : "transparent"
                }

                Text {
                  id: label
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(6)
                  text: modelData.label
                  color: modelData.urgent ? root.urgent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(6)
                  text: modelData.sub
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }

                MouseArea {
                  anchors.fill: parent
                  onClicked: { root.cursor = rowItem.index; root.activate() }
                }
              }
            }
          }

          Text {
            width: parent.width
            text: root.view.running
              ? "j/k move · enter start · x cancel"
              : "j/k move · enter start"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
