# Security

薄肌研究所 is meant for one person or a small group who trust each other and the operator. This page says what it protects, what it doesn't, and who can see what.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository ("Security" tab → "Report a vulnerability").

## Who can see what

| Who | Can | Cannot |
|---|---|---|
| A user (browser session) | read and write their own records, photos, plan and reports; create and revoke their own upload tokens | see other accounts |
| An admin (browser session) | everything a user can, plus create, disable and delete accounts and **reset any password**, which means they can log in as anyone | see other people's records in the UI, but see the line above: this is not a privacy boundary |
| An upload token (`lsj_…`, iPhone Shortcut) | `POST` Apple Health data (sleep, weight, body fat, steps, active energy, resting heart rate, HRV, and the last two days' heart rate and active energy samples) to its own account | read anything, use any other endpoint |
| **The CLI token `LSJ_TOKEN`** (Claude Code via `bin/lsj`) | **read and write every account's records and photos** (it names the account in `X-LSJ-User`), export them, list accounts | create, reset or disable accounts, manage tokens, log in to the web page |
| Root on the server | everything: the database, photos, backups, the env file with `LSJ_TOKEN` | |
| Anthropic | receives the photos and records Claude Code sends while processing | reach the server (the server never calls out) |

So whoever runs Claude Code holds `LSJ_TOKEN` and can read everyone's data. Keep it in `~/.config/lianshiji/config.json` with mode 600, never in the repository, and rotate it (change it in the server's env file and in `config.json`) if it may have leaked.

The optional 训记 integration keeps its API keys on the Claude Code computer (`~/.config/lianshiji/xunji.json`). A user may also store their own 训记 *training* key (read-only access to their workouts) on the server for the 「从训记同步」 button: it sits in the `xunji_keys` table, is used only when that user taps the button, is never returned to the page, logged or exported, and is deleted when the account is disabled or deleted. A user may likewise store their 训记 *template* key, which can only change the 「Agent 模版」 folder in their 训记 account: the server uses it only when that user taps 「写进训记」 on one of Claude's template proposals (the page lists every template, exercise, set count and weight from the exact request that will be sent), at most once every 10 s, and to read that folder once when the key is saved. Both keys are stored in plain text, so anyone with the server's database file or its backups can read them. Writes to 训记 always need the user's explicit yes: a tap on the page, or a yes in the Claude Code conversation for the `--confirmed` path.

Invites and sign-up: an admin can create invite links (`/join?code=…`); a code is shown once and only its SHA-256 hash is stored, it expires (1–90 days) and has a use limit (1–50), and an admin can revoke it. Anyone holding a valid link can create a member account, so share links privately. The public check/join endpoints answer every bad code the same way (no hint whether it expired, was used up or never existed), require same-origin JSON, and are rate-limited per address (10 failures per 10 minutes, at most 5 new accounts per hour). Admins get a push notification for every sign-up. New accounts confirm in the onboarding that their photos and records are analysed by Claude (Anthropic); until they do (`profile/prefs.consentAt`), Claude's runs skip their photos. `/privacy` explains all of this in plain Chinese.

Closing an account: a member can delete their own account (`DELETE /api/me` with their password; the last admin can't). It removes the account, every record, the photo folder, sessions, upload tokens, 训记 keys and push subscriptions; copies in existing backups remain until those age out.

Push notifications: the server sends empty Web Push messages only (no payload); the phone's service worker then fetches the title and text from `/api/push/next` with the page's login cookie, so the push service (Apple, Google, Mozilla) sees nothing of the content. Subscriptions are accepted only for those services' HTTPS endpoints, so a user can't make the server POST to arbitrary addresses. The VAPID signing key is `vapid.json` in the data directory (mode 0600, included in the daily backup); anyone with it can send pushes to subscribed phones but can't read data. Only the CLI token (Claude's runs) or an admin can queue a notification for someone; each person gets at most 6 a minute. A web login can also schedule one delayed reminder for itself (`POST /api/push/later`, 10–900 s ahead, for the rest timer; `DELETE /api/push/later/<id>` cancels it): it is kept in the server's memory only, goes through the same queue and limits when due, and a person can schedule at most 10 a minute.

Plan proposals and undo: only a web login can accept or decline a proposal (`/api/inbox/<id>/accept|decline`) or undo one of Claude's changes (`/api/log/<id>/undo`); the CLI token gets 403, so Claude cannot approve its own proposals. Both check that the plan still holds the values the proposal was made against and change nothing otherwise. Notes users leave for Claude (`messages`) are requests about their own training and diet; the skills treat them as such and not as a way to change rules, touch other accounts or skip 训记 confirmations. Scheduled runs (`scripts/auto-review.sh`) run Claude Code non-interactively with only `bin/lsj` and `bin/xunji` allowed, file reads limited to the project and the photo cache (`~/.cache/lianshiji/`), file writes limited to the project's `scratchpad/`, and with writes to `plan`, `plan_history` and `profile` refused by `bin/lsj` itself.

## What the server does

- Passwords: PBKDF2-SHA256 hashes. Sessions: random tokens stored as hashes, cookie `HttpOnly; SameSite=Lax` and `Secure` (unless `LSJ_COOKIE_SECURE=0` for local http testing), valid for a year
- Upload tokens are stored as hashes, deleted when an account is disabled or deleted (re-enabling doesn't restore them), and cleaned up at startup for disabled accounts. Neither upload tokens nor the CLI token count as a web login
- Login limits: within 10 minutes, 5 failures for the same username + address, 30 for a username, or 20 for an address return 429; a wrong current password when changing passwords counts too. `X-Real-IP` is believed only on connections from the same machine (the reverse proxy)
- Cookie-authenticated writes must be same-origin (`Origin` or `Sec-Fetch-Site`) and carry `Content-Type: application/json` (photos: `image/*`); the CSP allows no inline scripts and no framing
- Input limits: JSON bodies up to 1 MiB, photos up to 20 MiB (JPEG, PNG, WebP, GIF, checked by content), versions must be non-negative integers, NaN/Infinity and nesting deeper than 32 levels are rejected; ids and collection names are checked against fixed patterns
- Apple Health uploads: daily values go into `health/<date>`, `sleep/` and `body/`. The heart rate and active energy samples (the Shortcut sends the last two days with every sync, with each sample's source device name) are only used to put a summary on the person's own workouts logged in 训练中 (average, maximum and minimum heart rate, number of samples, energy burned); the samples and source names themselves are not stored
- Errors: clients get a generic message; details go to the journal
- Standard library only. The only outbound connections are the optional 训记 buttons: HTTPS to 训记, only when a user with a stored key taps 「从训记同步」 (at most once a minute per user) or 「写进训记」 (at most once every 10 s), 10 s timeout per request. The sample systemd unit blocks all outbound traffic; remove its `IPAddressDeny`/`IPAddressAllow` lines to use them

## What the deploy files add

- `deploy/lianshiji.service`: unprivileged user, no capabilities, read-only system, writable only `/var/lib/lianshiji`, localhost-only networking (`IPAddressDeny=any`), `@system-service` syscall filter, `UMask=0077`
- `deploy/nginx.conf.example`: TLS 1.2+ with ECDHE AEAD ciphers, `server_tokens off`, 1 MB body limit except photo uploads, login rate limit (`limit_req`, 429)
- `deploy/fail2ban/`: bans an address for an hour after 10 failed or rate-limited logins in 10 minutes
- `deploy/lianshiji-backup.cron`: daily database and weekly photo backups, created with `umask 077`

## Known limits

- Data and backups are not encrypted at rest, and backups sit on the same disk unless you copy them elsewhere
- An admin can impersonate anyone by resetting their password; root and `LSJ_TOKEN` see everything
- Text in records (meal notes, workout notes) is user data that Claude reads. The skills tell Claude to treat it as data, not instructions, to process one account at a time and to write only to the account it is processing (`bin/lsj batch` refuses a batch whose `user` differs from `-u`). This lowers, but cannot rule out, the risk of one account's text steering what Claude writes
- Photo estimates are estimates; nothing here is medical advice
- The signed iOS Shortcut contains the server address. `deploy/make-shortcut.py` checks that a signed file matches the local build before using it, whichever service signed it
