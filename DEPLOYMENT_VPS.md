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
