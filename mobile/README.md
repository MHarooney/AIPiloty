# AIPiloty Mobile

A Flutter mobile app that connects to your AIPiloty desktop agent over LAN — a "Claude-style remote to your Mac."

## Requirements

- Flutter 3.22+ (tested with 3.32.0)
- iOS 15+ or Android 8+
- Same Wi-Fi network as your Mac running the AIPiloty backend

## Setup

```bash
cd aipiloty/mobile
flutter pub get
flutter run          # iOS simulator or Android emulator
flutter run -d <id>  # Specific device
```

## Connecting to Your Desktop Agent

1. Start the AIPiloty backend on your Mac (`make dev` or `docker compose up`)
2. Find your Mac's local IP: `ipconfig getifaddr en0` (usually `192.168.x.x`)
3. Open the mobile app → enter `http://<your-mac-ip>:8000` as the Backend URL
4. If you set an API key in `.env`, enter it in the API Key field
5. Tap **Test Connection** → green checkmark means success
6. Tap **Save & Continue**

## Screens

| Tab | Purpose |
|-----|---------|
| **Chat** | Send messages, see SSE streaming tokens, tool status, markdown rendering |
| **Sessions** | List past chat sessions from the backend |
| **Health** | Backend, Ollama, RAG/Qdrant status dashboard |

## Architecture

- **State management**: Riverpod (AsyncNotifier for config, Provider for Dio)
- **Networking**: Dio for REST, raw `http` package for POST-based SSE streaming
- **Secure storage**: `flutter_secure_storage` for base URL + API key
- **Theme**: Dark Material 3 with indigo accent

## Notes

- HTTPS is **not** configured by default. For LAN use this is acceptable.
- For remote access (outside LAN), set up a tunnel (e.g., Tailscale, ngrok, Cloudflare Tunnel).
- The app stores connection details in secure storage and restores them on launch.
