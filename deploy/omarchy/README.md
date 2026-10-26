# Omarchy integration

The active Omarchy plugin is installed at
`~/.config/omarchy/plugins/dnames.himalaya-mail/`. The source copy in this
directory is the reproducible project template; Omarchy loads the active user
copy, not files from this repository.

Install/update the local widget explicitly:

```bash
mkdir -p ~/.config/omarchy/plugins/dnames.himalaya-mail
cp dnames.himalaya-mail/manifest.json ~/.config/omarchy/plugins/dnames.himalaya-mail/
cp dnames.himalaya-mail/Widget.qml ~/.config/omarchy/plugins/dnames.himalaya-mail/
omarchy plugin validate ~/.config/omarchy/plugins/dnames.himalaya-mail
omarchy bar put dnames.himalaya-mail --after omarchy.tray
omarchy restart shell
```

The widget opens `http://127.0.0.1:47831/`. Keep the service loopback-only and
do not add credentials to the plugin or shell configuration.

## The widget token

Once at least one account has `watch: true` in
`~/.config/himalaya-web/accounts.json`, the running service writes a
read-only, badge-only token to `~/.config/himalaya-web/widget-token` (mode
`0600`). It authorizes only `GET /api/watch/summary` (unread counts, no
message content) and rotates every service restart. The widget reads this
file itself; nothing needs to be configured manually. If no account is
watched, the file does not exist and the widget stays a plain `✉` icon.
