import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui

BarWidget {
    id: root
    moduleName: "dnames.himalaya-mail"
    implicitWidth: button.implicitWidth
    implicitHeight: barSize

    property int unreadCount: 0
    property string pollStdout: ""

    WidgetButton {
        id: button
        bar: root.bar
        text: root.unreadCount > 0 ? "✉ " + root.unreadCount : "✉"
        tooltipText: "Himalaya Mail im Browser öffnen"
        horizontalMargin: 7
        onPressed: function(mouseButton) {
            if (mouseButton === Qt.LeftButton)
                Quickshell.execDetached(["xdg-open", "http://127.0.0.1:47831/"])
        }
    }

    function poll() {
        if (pollProcess.running) return
        pollStdout = ""
        pollProcess.running = true
    }

    // Reads the widget token from disk fresh on every poll (the server
    // rotates it on every restart, see index.ts) and requests the unread
    // summary in one step. Process/StdioCollector idiom matches this
    // account's other polling widgets (e.g. akitaonrails.ai-usagebar's
    // usageProcess: running: false + a running guard + waitForEnd +
    // onExited, rather than parsing straight from onStreamFinished).
    Process {
        id: pollProcess
        running: false
        command: [
            "sh", "-c",
            "token=$(cat " + Quickshell.env("HOME") + "/.config/himalaya-web/widget-token 2>/dev/null) && " +
            "curl -sf -m 5 -H \"x-himalaya-session: $token\" http://127.0.0.1:47831/api/watch/summary"
        ]

        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: root.pollStdout = text
        }

        onExited: function(exitCode) {
            if (exitCode !== 0) return // keep the last known badge value on failure
            try {
                const summary = JSON.parse(root.pollStdout)
                root.unreadCount = typeof summary.totalUnread === "number" ? summary.totalUnread : 0
            } catch (e) {
                // Keep the last known badge value on a parse failure.
            }
        }
    }

    Timer {
        interval: 60000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.poll()
    }
}
