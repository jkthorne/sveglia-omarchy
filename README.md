# saltare.sveglia

A countdown timer for the [Omarchy](https://omarchy.org) bar. Pick a duration,
watch the number, get a toast. It is the desktop half of sveglia, the fleet's
clock app.

```
⏱ 4:32
┌───────────────────────────────┐
│ 4:32                          │
│ 5 minutes                     │
│ RUNNING                       │
│   5 minutes             4:32  │
│ REPLACE WITH                  │
│   1 minute                1m  │
│   3 minutes               3m  │
│   5 minutes               5m  │
│   10 minutes             10m  │
│   25 minutes             25m  │
│   1 hour                 60m  │
│ j/k move · enter start · x …  │
└───────────────────────────────┘
```

## It needs no account

No server, no session, no `sal`, no network. sveglia is the one app in the
fleet that never needed a backend — an alarm is a local fact — and that is as
true on a laptop as it is on a phone. Install it and it works; you do not have
to have heard of Saltare.

```sh
omarchy plugin add https://github.com/jkthorne/sveglia-omarchy.git --enable --yes
```

## systemd owns the alarm

The widget does not fire the notification. Starting a timer schedules a
transient user unit:

```sh
systemd-run --user --unit=sveglia-timer --on-active=300 \
  omarchy-notification-send -u critical Timer '5 minutes is up'
```

Three problems solved at once, and none of them by the widget:

- **It fires once.** A bar widget is instantiated once per monitor, so a
  countdown living in QML would raise one toast per screen. One unit raises
  one toast.
- **It outlives the shell.** `omarchy-restart-shell`, a crash, a plugin
  reload — the alarm is a different process and does not care.
- **Starting replaces.** `--unit` refuses a duplicate, so a second timer
  cannot quietly coexist with the first. The widget stops the old one on the
  way in, which is what a bar timer should do anyway.

What is left for the widget is the number, which is what a widget is for.

## A glyph when idle, a number when counting

The bar shows `⏱` with nothing running and `⏱ 4:32` with something running.
The last minute draws in the bar's urgent colour.

The first version of this hid the widget entirely when idle — a bar that is
quiet when it has nothing to say is the one people keep. It also made the
timer unstartable, because the popup anchors to the bar button and a button
that is not there is a widget you cannot click. **This one is a control, not a
display.** The glyph is the affordance; the number is the state.

`showWhenIdle: false` gives the disappearing version back, for anyone who
binds a key to it:

```lua
o.bind("SUPER + SHIFT + T", "Timer", "omarchy-shell sveglia toggle")
```

## Keys

`j`/`k` move · `enter` starts the selected duration (replacing a running one) ·
`x` cancels · `esc` closes. **Right-click the bar widget cancels without
opening anything** — stopping a timer is the one thing you want to do in a
hurry, and a popup is in the way of it.

## What it stores

One file, `$XDG_STATE_HOME/sveglia/timer.json` (`~/.local/state/…` without
one), holding the end time and the label. It exists for the same reason the
workspace widget's state file does: a bar widget is instantiated once per
monitor, and two instances each holding their own countdown would disagree
about the same timer within a second of starting it.

Cancelling writes `{"schema": 1}` rather than truncating, because a zero-byte
file is also what a failed write leaves behind.

## Settings

| Key | Default | What it does |
|---|---|---|
| `statePath` | `$XDG_STATE_HOME/sveglia/timer.json` | where the countdown is kept |
| `showWhenIdle` | `true` | off hides the widget until a timer is counting |

## Hacking

```sh
node --test tests/model.test.js    # all of the logic
omarchy plugin validate .          # the manifest
bin/ci                             # both, as CI runs them
```

`Model.js` holds every decision — the presets, the countdown arithmetic, and
the argv each row runs — as pure functions, and the QML is a renderer over it.
Omarchy's plugin API is young; the parts worth protecting from it are the
parts that decide things.

Two things about the edit loop, both learned next door in
[saltare-omarchy](https://github.com/jkthorne/saltare-omarchy):

- **Do not symlink your checkout into `~/.config/omarchy/plugins/`.** The
  shell watches that directory with inotify, which does not follow symlinks,
  so your edits never trigger a reload. Copy the tree in.
- **`omarchy-shell shell rescanPlugins` is not always enough.** When a change
  seems not to take, `omarchy-restart-shell` and trust that.

To watch a state without waiting for it:

```sh
# a timer with ten seconds left
printf '{"schema":1,"label":"10 seconds","duration_sec":10,"ends_at":"%s"}\n' \
  "$(date -u -d '+10 seconds' +%Y-%m-%dT%H:%M:%SZ)" \
  > ~/.local/state/sveglia/timer.json
```

## Why this is the only fleet app with a bar widget

The fleet has ten phone apps and exactly one of them earns a slot here. The
argument is written down in saltare-machina's `docs/linux-desktop.md` §11: a
bar slot is for **continuous state you glance at**, not for a list you go to.
A running countdown is the best-shaped bar widget there is. Notes, files,
photos and contacts are things you go to, and they are reachable from
saltare.workspace's capture field instead.

## License

MIT.
