# Privacy Policy — Hima

Last updated: 2026-11-03

## Summary

Hima collects nothing about you and contains no advertising, analytics or
tracking of any kind. It runs on your own computer and talks only to the mail
servers you configured in Himalaya. One optional AI feature sends a message to
a provider you choose, and only when you set it up and ask for it.

## What it is

Hima is a local web interface for the [Himalaya](https://github.com/soywod/himalaya)
mail CLI. It is not a hosted service and has no account or registration. Its
server binds to the loopback address `127.0.0.1` only, so no other machine on
your network can reach it.

## Where your data goes

- **Your mail servers.** Reading, searching, sending and moving mail runs
  through the Himalaya CLI against the IMAP/SMTP/JMAP/Maildir accounts in your
  own `~/.config/himalaya/config.toml`. Hima adds no server of its own.
- **Remote images** in HTML mail are blocked by default, so opening a message
  does not tell the sender that you read it. You can allow them per message or
  per sender.
- **Optional AI assist.** Only when you set `HIMALAYA_AI_API_KEY` does Hima
  enable summaries and reply drafts. Then, and only when you press one of
  those buttons, the text of that one message or draft is sent over HTTPS to
  the configured provider (MiniMax by default, `HIMALAYA_AI_BASE_URL`, which must be
  an `https://` address or the feature stays off). That
  provider's own privacy policy applies to it. Without the key nothing is sent.
- Nothing else. No usage statistics, crash reports or diagnostics are produced
  or transmitted.

## What is stored on your computer

- **Credentials** stay where Himalaya keeps them (your OS keyring or your
  Himalaya configuration). Hima never stores passwords in the browser.
- **Local app files** under `~/.config/himalaya-web/`: account order, local
  labels, snoozed messages, rules and a local access token. They never leave
  your machine.
- **Browser storage** (`localStorage` on `127.0.0.1`): UI preferences such as
  the last opened account and folder, and autosaved drafts. Hima sets no
  cookies.

Delete those files and the site data of the address you open Hima at
(`127.0.0.1:47831`, or `localhost:47831`) in your browser to
remove everything Hima kept locally.

## Children

Hima is a general-purpose mail client and is not directed at children.

## Contact

Questions about this policy: open an issue at
<https://github.com/DnaMes/hima/issues>.
