# LAN Access Guide — AIPiloty

Access AIPiloty from other devices on the same local network (phones, tablets, other PCs).

## Prerequisites

- Backend and frontend are running on your host machine
- All devices are on the same Wi-Fi / LAN

## 1. Find Your Host IP

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

Example: `192.168.1.42`

## 2. Configure Backend CORS

In `backend/.env`, allow the LAN origin:

```env
CORS_ORIGINS=http://localhost:3000,http://192.168.1.42:3000
```

Restart the backend after changes.

## 3. Start Backend on 0.0.0.0

The backend must bind to all interfaces:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

## 4. Configure Frontend API URL

In `frontend/.env.local`, point to the LAN-accessible backend:

```env
NEXT_PUBLIC_API_URL=http://192.168.1.42:8100
```

## 5. Start Frontend on 0.0.0.0

```bash
cd frontend
npx next dev -H 0.0.0.0 -p 3000
```

## 6. Access From Other Devices

Open a browser on any LAN device and navigate to:

```
http://192.168.1.42:3000
```

## Remote Access (Outside LAN)

For access beyond your local network, use a secure tunnel:

### Cloudflare Tunnel (recommended)

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

### ngrok

```bash
ngrok http 3000
```

Update `NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` accordingly when using tunnels.

## Firewall Notes

- macOS: Allow incoming connections for Node.js and Python when prompted
- Linux: Ensure ports 3000 and 8100 are open (`sudo ufw allow 3000,8100/tcp`)

## Ollama Access

If Ollama runs on the same host, it defaults to `localhost:11434`. For LAN access to Ollama directly:

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Update `OLLAMA_BASE_URL` in `backend/.env`:

```env
OLLAMA_BASE_URL=http://192.168.1.42:11434
```
