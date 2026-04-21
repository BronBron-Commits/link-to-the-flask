# VPS Deployment Notes

## Socket.IO reverse proxy (nginx)

Use this location block so WebSocket upgrades work reliably behind nginx:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

## Cloudflare settings

- Enable WebSockets.
- Disable Rocket Loader for this app.
- Use a DNS-only record during initial bring-up if troubleshooting handshake failures.

## Runtime checks

- Verify `/socket.io/?EIO=4&transport=polling` returns `200`.
- Confirm clients connect with transport fallback available.
- Check that DM-only combat controls are enforced server-side.

## Gunicorn worker

Avoid `eventlet` workers (deprecated in Gunicorn). Run Socket.IO with gevent websocket worker:

```bash
gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 app:app -b 0.0.0.0:5000
```

## Discord OAuth environment setup

This app reads Discord OAuth values from process environment variables.

1. Copy the template:

```bash
cp deployment/discord-oauth.env.example deployment/discord-oauth.env
```

2. Edit `deployment/discord-oauth.env` and set the real secret:

```bash
DISCORD_CLIENT_ID=1492219079237304493
DISCORD_CLIENT_SECRET=YOUR_REAL_DISCORD_CLIENT_SECRET
DISCORD_REDIRECT_URI=https://game.bronbron.org/auth/discord/callback
DISCORD_OAUTH_SCOPE="identify email"
```

3. Load env vars before starting Gunicorn:

```bash
source scripts/load_discord_env.sh
gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 app:app -b 0.0.0.0:5000
```

For systemd, mirror these values in your service unit using `Environment=` or `EnvironmentFile=`.
