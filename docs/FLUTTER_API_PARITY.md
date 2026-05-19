# Flutter Mobile API Parity Matrix

Comparison between the **DeployPilot Flutter mobile app** (`deployment-platform/mobile_app/`) and the **AIPiloty backend API** to identify which endpoints a future AIPiloty mobile app would need to integrate.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Exists in AIPiloty backend — ready for mobile |
| 🔶 | Partially available — needs adaptation |
| ❌ | Not available — needs backend work |

---

## Core Endpoints

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **Health check** | `/api/v1/health` | GET | ✅ | Returns Ollama + DB status |
| **Chat (stream)** | `/api/v1/chat` | POST | 🔶 | SSE stream — mobile needs EventSource or chunked reader |
| **Chat sessions list** | `/api/v1/chat/sessions` | GET | ✅ | |
| **Session messages** | `/api/v1/chat/sessions/{key}` | GET | ✅ | |
| **Delete session** | `/api/v1/chat/sessions/{key}` | DELETE | ✅ | |

## DevOps — Deployments

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **List deployments** | `/api/v1/deploy` | GET | ✅ | |
| **Create deployment** | `/api/v1/deploy` | POST | ✅ | |
| **Get deployment** | `/api/v1/deploy/{id}` | GET | ✅ | |
| **Deploy action** | `/api/v1/deploy/{id}/deploy` | POST | ✅ | |
| **Stop/Restart** | `/api/v1/deploy/{id}/stop` | POST | ✅ | |

## DevOps — VMs

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **List VMs** | `/api/v1/vms` | GET | ✅ | |
| **Register VM** | `/api/v1/vms` | POST | ✅ | |
| **Get VM** | `/api/v1/vms/{id}` | GET | ✅ | |
| **Trust host key** | `/api/v1/vms/{id}/trust` | POST | ✅ | TOFU pattern |
| **Delete VM** | `/api/v1/vms/{id}` | DELETE | ✅ | |

## Knowledge Base

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **KB health** | `/api/v1/knowledge/health` | GET | ✅ | |
| **KB stats** | `/api/v1/knowledge/stats` | GET | ✅ | |
| **Search KB** | `/api/v1/knowledge/search` | GET | ✅ | |
| **List documents** | `/api/v1/knowledge` | GET | ✅ | |
| **Get document** | `/api/v1/knowledge/{id}` | GET | ✅ | |
| **Ingest text** | `/api/v1/knowledge` | POST | ✅ | |
| **Upload file** | `/api/v1/knowledge/upload` | POST | 🔶 | Multipart — mobile file picker needed |
| **Delete document** | `/api/v1/knowledge/{id}` | DELETE | ✅ | |

## Database Browser

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **List tables** | `/api/v1/database/tables` | GET | ✅ | Read-only |
| **Table schema** | `/api/v1/database/tables/{name}/schema` | GET | ✅ | |
| **Table rows** | `/api/v1/database/tables/{name}` | GET | ✅ | Paginated |

## Workspace / Code Viewer

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **File tree** | `/api/v1/workspace/tree` | GET | ✅ | |
| **Read file** | `/api/v1/workspace/file` | GET | ✅ | Read-only, max 500KB |

## Config

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **Get config** | `/api/v1/config` | GET | ✅ | Non-sensitive settings only |

## File Downloads

| Feature | AIPiloty Endpoint | Method | Mobile Ready | Notes |
|---------|-------------------|--------|:------------:|-------|
| **Download file** | `/api/v1/files/download` | GET | 🔶 | Binary stream — mobile needs download manager |

---

## Mobile-Specific Considerations

### Authentication
All endpoints require `X-API-Key` header. For mobile:
- Store API key securely (iOS Keychain / Android Keystore)
- Support QR code scan for easy key setup from desktop

### SSE Streaming (Chat)
The chat endpoint uses Server-Sent Events. Flutter options:
- `flutter_client_sse` package
- `http` package with `StreamedResponse`
- `dio` with response type `ResponseType.stream`

### Network Discovery
For LAN usage, consider implementing:
- mDNS/Bonjour discovery for auto-detecting AIPiloty backend
- Manual IP entry with saved servers

### Push Notifications
Not currently supported — would need:
- WebSocket upgrade or Firebase for deployment status alerts
- New backend endpoint: `POST /api/v1/push/register`

---

## Summary

| Category | Total | Ready | Partial | Missing |
|----------|:-----:|:-----:|:-------:|:-------:|
| Core Chat | 5 | 4 | 1 | 0 |
| Deployments | 5 | 5 | 0 | 0 |
| VMs | 5 | 5 | 0 | 0 |
| Knowledge | 8 | 7 | 1 | 0 |
| Database | 3 | 3 | 0 | 0 |
| Workspace | 2 | 2 | 0 | 0 |
| Config | 1 | 1 | 0 | 0 |
| Files | 1 | 0 | 1 | 0 |
| **Total** | **30** | **27** | **3** | **0** |

**90% of endpoints are immediately mobile-ready.** The 3 partial items (SSE streaming, file upload, file download) need standard mobile adapter patterns but no backend changes.
