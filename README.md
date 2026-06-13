# MT-PT Keeper

A small Playwright-based keepalive daemon for MT-PT / M-Team accounts.

MT-PT accounts can be disabled when they stay inactive for too long. This tool keeps an already-authenticated browser session warm by visiting authenticated pages every day, opening one detail page, and alerting you when the session expires.

It does not bypass captcha, solve anti-bot challenges, or store your tracker password. You log in manually once, then Keeper reuses the local browser profile.

## Features

- Manual session bootstrap for captcha-protected login
- Persistent Playwright browser profile with cookies, localStorage, and IndexedDB
- Daily cron keepalive with configurable timezone
- Optional detail-page interaction for more realistic activity
- Ant Design modal handling with click, DOM click, and direct navigation fallbacks
- Telegram alerts for every run, including successful keepalive runs
- Successful Telegram alerts include current downloaded, uploaded, and ratio stats when available
- Slack/Discord-compatible webhook support
- Docker Compose and PM2 friendly
- Debug logs for selectors, candidate detail links, modals, and navigation

## Quick Start

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.template .env
```

Edit `.env`:

```bash
MT_PT_BASE_URL=https://kp.m-team.cc/
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Initialize the session on a machine with a display:

```bash
pnpm init-session
```

Log in manually in the opened browser and complete captcha. Keeper saves the browser profile in `.keeper/browser-profile`.

Verify the saved session:

```bash
pnpm once
```

Run continuously:

```bash
pnpm daemon
```

By default it runs immediately on startup, then every day at `09:00` in `Asia/Shanghai`.

## How It Works

1. `init-session` opens a headed browser with a persistent profile.
2. You complete login and captcha manually.
3. `once` or `daemon` opens the same profile in headless mode.
4. Keeper visits configured keepalive URLs.
5. If still authenticated, it opens one detail link from the list page.
6. If a login form, captcha page, `401`, or `403` appears, the run is marked as `expired` and an alert is sent.

## Detail Interaction

Keeper tries to click one detail/torrent link after the session check passes. This gives the site a more realistic interaction than loading only the index page.

Default link detection covers common patterns like `/detail`, `/torrent`, and text such as `详情` / `Detail`. Override it when needed:

```bash
KEEPER_DETAIL_LINK_SELECTOR='a[href*="/profile/detail/"]'
```

If an announcement modal blocks the click, Keeper tries to close common Ant Design modal buttons first. Override the close target when needed:

```bash
KEEPER_MODAL_CLOSE_SELECTOR='.ant-modal-wrap button:has-text("我知道了")'
```

If the modal still intercepts the pointer click, Keeper logs the modal summary, then falls back to a DOM click. If that still does not navigate, it opens the detail `href` directly.

Disable detail interaction:

```bash
KEEPER_INTERACTION_ENABLED=false
```

## Keepalive URLs

By default Keeper visits `MT_PT_BASE_URL`. If your tracker refreshes tokens only on specific pages or API endpoints, configure multiple URLs:

```bash
KEEPER_KEEPALIVE_URLS=https://kp.m-team.cc/,https://kp.m-team.cc/user/profile
```

Use comma-separated URLs.

## Notifications

Telegram:

```bash
TELEGRAM_BOT_TOKEN=123456:xxx
TELEGRAM_CHAT_ID=123456789
```

Generic JSON webhook:

```bash
KEEPER_WEBHOOK_URL=https://example.com/webhook
```

Telegram sends success notifications whenever `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` are configured. Successful Telegram messages include the
current downloaded, uploaded, and ratio stats when they are available on the
page.

Generic webhook success notifications are disabled by default. Enable them with:

```bash
KEEPER_NOTIFY_SUCCESS=true
```

## Debugging

Run with debug logs:

```bash
LOG_LEVEL=debug pnpm once
```

The logs include:

- keepalive URLs
- detail selectors and candidate links
- clicked detail target
- blocking modal text and close buttons
- fallback navigation result

When session detection needs tuning, use regex overrides:

```bash
MT_PT_SUCCESS_URL_PATTERN=
MT_PT_SUCCESS_TEXT_PATTERN=
MT_PT_EXPIRED_URL_PATTERN=
MT_PT_EXPIRED_TEXT_PATTERN=
```

## Docker

```bash
docker compose up -d --build
```

The `.keeper` directory is mounted so browser session data and the latest status survive restarts.

You still need to initialize the session first on a machine that can show the browser, then keep or copy `.keeper/browser-profile` for the daemon.

## PM2

```bash
pnpm build
pm2 start dist/index.js --name mt-pt-keeper -- daemon
pm2 save
```

When you get an expiry alert:

```bash
pnpm init-session
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MT_PT_BASE_URL` | `https://kp.m-team.cc/` | Site entry URL. |
| `KEEPER_KEEPALIVE_URLS` | `MT_PT_BASE_URL` | Comma-separated authenticated URLs to visit. |
| `KEEPER_CRON` | `0 9 * * *` | Daily schedule. |
| `KEEPER_TIMEZONE` | `Asia/Shanghai` | Cron timezone. |
| `KEEPER_HEADLESS` | `true` | Headless mode for `once` and `daemon`; `init-session` is always headed. |
| `KEEPER_USER_DATA_DIR` | `.keeper/browser-profile` | Persistent Playwright profile path. |
| `KEEPER_STATE_FILE` | `.keeper/state.json` | Last run status. |
| `KEEPER_SCREENSHOT_DIR` | `.keeper/screenshots` | Failure screenshot path. |
| `KEEPER_INTERACTION_ENABLED` | `true` | Click one detail link after the session check. |
| `KEEPER_DETAIL_LINK_SELECTOR` | auto | Optional selector for detail links. |
| `KEEPER_MODAL_CLOSE_SELECTOR` | auto | Optional selector for closing announcement modals. |
| `LOG_LEVEL` | `info` | Set to `debug` for selector scan details. |
| `MT_PT_USERNAME_SELECTOR` | auto | Optional selector to help detect a login page. |
| `MT_PT_PASSWORD_SELECTOR` | auto | Optional selector to help detect a login page. |
| `MT_PT_SUCCESS_URL_PATTERN` | empty | Optional regex that marks session valid by URL. |
| `MT_PT_EXPIRED_URL_PATTERN` | empty | Optional regex that marks session expired by URL. |
| `MT_PT_SUCCESS_TEXT_PATTERN` | empty | Optional regex that marks session valid by page text. |
| `MT_PT_EXPIRED_TEXT_PATTERN` | empty | Optional regex that marks session expired by page text. |
| `KEEPER_NOTIFY_SUCCESS` | `false` | Send success notifications to the generic webhook too. Telegram success notifications are always sent when Telegram is configured. |
| `KEEPER_WEBHOOK_URL` | empty | Optional Slack/Discord-compatible JSON webhook. |
| `TELEGRAM_BOT_TOKEN` | empty | Telegram bot token for alerts. |
| `TELEGRAM_CHAT_ID` | empty | Telegram chat id for alerts. |

## Security Notes

- Do not commit `.env` or `.keeper`.
- `.keeper/browser-profile` contains authenticated session data.
- This project is intended for personal account maintenance, not for bypassing tracker rules, captcha, or access controls.
- Respect the rules of the tracker you use.

## License

MIT
