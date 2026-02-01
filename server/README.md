# 🚀 Network Logger Server

Unified Rust server with **Simple** and **Production** modes. Receives network logs, extension events, and security events from the Chrome extension. Supports gzip-compressed payloads and client identification.

---

## 🎯 Modes

### Simple Mode (Default)
- ✅ In-memory storage
- ✅ No database required
- ✅ Perfect for testing
- ✅ Fast startup
- ✅ Stores last 1000 logs
- ✅ Gzip decompression (optional)

### Production Mode
- ✅ PostgreSQL database
- ✅ Optional Redis caching
- ✅ Unlimited storage
- ✅ High performance
- ✅ Persistent data
- ✅ `client_id` stored with logs and extension events

---

## 🚀 Quick Start

### Simple Mode (No Setup Required)

```bash
cd server

# Build
cargo build --release

# Run
cargo run --release -- --mode simple

# Or with custom port
cargo run --release -- --mode simple --port 3000
```

**That's it!** Server runs on `http://127.0.0.1:8080`

**Web dashboard:** Open `http://127.0.0.1:8080/` or `http://127.0.0.1:8080/dashboard` for:
- **Events** – All / Security / JavaScript tabs with search, date range, filters, pagination, column sorting
- **Network logs** – Request logs with client_id, search, export CSV
- **Clients** – Unique client IDs (click to copy)
- **Blocklist** – URL patterns and YouTube channels
- **Inspect** – Click any event to view full JSON (syntax highlighting, copy, search)
- Light/dark theme, auto-refresh toggle, connection status

### Production Mode

```bash
# 1. Install PostgreSQL
# macOS: brew install postgresql
# Ubuntu: apt install postgresql

# 2. Create database
createdb network_logger

# 3. Load schema
psql network_logger < schema.sql

# 4. Build with production features
cargo build --release --features production

# 5. Run
cargo run --release --features production -- \
  --mode production \
  --database-url "postgresql://user:password@localhost/network_logger"

# Optional: With Redis
cargo run --release --features production -- \
  --mode production \
  --database-url "postgresql://user:password@localhost/network_logger" \
  --redis-url "redis://127.0.0.1:6379"
```

---

## 📋 Command-Line Options

```bash
network-logger-server [OPTIONS]

Options:
  -m, --mode <MODE>              Server mode: simple or production [default: simple]
  -h, --host <HOST>               Server host [default: 127.0.0.1]
  -p, --port <PORT>               Server port [default: 8080]
      --database-url <URL>        Database URL (production only)
      --redis-url <URL>           Redis URL (production only)
      --help                      Print help
```

---

## 🌐 API Endpoints

### Web Dashboard
```bash
GET /
GET /dashboard
GET /logo.png
```
Serves the dashboard HTML and logo. Dashboard features: search by client_id/time/url, date range filters, pagination (50 rows), column sorting, tab badges, export CSV, packet inspection with JSON copy/search, resizable panels, blocklist confirmation.

### Dashboard API (Simple Mode)
```bash
GET /api/dashboard/events?filter=all|security|javascript
# Returns events with packet_id, event_type, category, page_domain, script_domain, client_id, timestamp, risk_score

GET /api/dashboard/events/{packet_id}
# Returns full event JSON for inspection

GET /api/dashboard/clients
# Returns { "clients": ["uuid1", "uuid2", ...] }
```

### Health Check
```bash
GET /health

Response:
{
  "status": "healthy",
  "timestamp": "2025-01-28T12:00:00Z",
  "client_ip": "127.0.0.1"
}
```

### Post Logs (Network Requests)
```bash
POST /api/logs
Content-Type: application/json
Content-Encoding: gzip   # Optional: body can be gzip-compressed JSON

{
  "client_id": "uuid-from-extension",
  "sessionId": "session-123",
  "timestamp": "2025-01-28T12:00:00Z",
  "user_agent": "Mozilla/5.0...",
  "logs": [
    {
      "requestId": "req-456",
      "url": "https://example.com",
      "method": "GET",
      "type": "main_frame",
      "blocked": false
    }
  ]
}
```

- **client_id** (optional): Persistent client identifier from the extension; stored in production.
- **Gzip**: If `Content-Encoding: gzip` is sent, the body is decompressed before parsing. On decompression error, the server falls back to treating the body as plain UTF-8 JSON (no 400).

### Get Logs (Simple Mode Only)
```bash
GET /api/logs

Response: Array of log entries (each with client_id if present)
```

### Get Blocklist
```bash
GET /api/blocklist

Response:
{
  "urlPatterns": [
    ".*tracker\\..*",
    ".*analytics\\..*"
  ],
  "youtubeChannels": [
    "@spam"
  ]
}
```

### Update Blocklist
```bash
POST /api/blocklist
Content-Type: application/json

{
  "urlPatterns": [
    ".*newpattern\\..*"
  ],
  "youtubeChannels": [
    "@newchannel"
  ]
}
```

### Post Extension Events
```bash
POST /api/extensions
Content-Type: application/json
Content-Encoding: gzip   # Optional

{
  "client_id": "uuid-from-extension",
  "sessionId": "session-123",
  "timestamp": "2025-01-28T12:00:00Z",
  "user_agent": "Mozilla/5.0...",
  "event_type": "extension_change",
  "data": {
    "action": "installed",
    "extension": {
      "name": "Extension Name"
    }
  }
}
```

Used for extension lifecycle and monitoring events (install, uninstall, etc.). **client_id** is stored in production.

### Post Security Events
```bash
POST /api/security
Content-Type: application/json
Content-Encoding: gzip   # Optional

{
  "client_id": "uuid-from-extension",
  "sessionId": "session-123",
  "timestamp": "2025-01-28T12:00:00Z",
  "user_agent": "Mozilla/5.0...",
  "event_type": "clickfix_detection",
  "data": {
    "type": "powershell",
    "riskScore": 85,
    "codeSnippet": "..."
  }
}
```

Used for security-related events from the extension:
- **clickfix_detection**: Clipboard/copy-based social engineering (e.g. PowerShell in console).
- **extension_security_scan**: Results of extension security scans.

Same JSON shape as `/api/extensions`; **client_id** is stored in production. The extension sends security events here and other extension events to `/api/extensions`.

---

## 📦 Request / Response Summary

| Endpoint                        | Method | Gzip | client_id | Purpose                    |
|---------------------------------|--------|------|-----------|----------------------------|
| `/` / `/dashboard`              | GET    | —    | —         | Web dashboard              |
| `/logo.png`                     | GET    | —    | —         | CanIGoIn logo              |
| `/health`                       | GET    | —    | —         | Health check               |
| `/api/logs`                     | POST   | ✅   | ✅        | Batch network logs         |
| `/api/logs`                     | GET    | —    | —         | Get logs (simple only)     |
| `/api/dashboard/events`         | GET    | —    | —         | Events for dashboard       |
| `/api/dashboard/events/{id}`    | GET    | —    | —         | Inspect single event       |
| `/api/dashboard/clients`        | GET    | —    | —         | Unique client IDs          |
| `/api/blocklist`                | GET    | —    | —         | Get blocklist              |
| `/api/blocklist`                | POST   | —    | —         | Update blocklist           |
| `/api/extensions`               | POST   | ✅   | ✅        | Extension lifecycle events |
| `/api/security`                 | POST   | ✅   | ✅        | Security events (clickfix, etc.) |

---

## 🗄️ Database Schema (Production Mode)

### Tables

**network_logs**
- `id` - Primary key
- `client_id` - Client identifier from extension (optional)
- `session_id` - Browser session
- `timestamp` - Request time
- `user_agent` - Browser info
- `request_id` - Request identifier
- `url` - Requested URL
- `method` - HTTP method
- `request_type` - Request type
- `blocked` - Whether blocked
- `block_reason` - Block reason
- `created_at` - Insert time

**blocklist_patterns**
- `id` - Primary key
- `pattern` - Regex pattern
- `type` - 'url' or 'youtube'
- `description` - Pattern description
- `added_by` - Who added it
- `added_at` - When added
- `active` - Is active

**extension_events**
- `id` - Primary key
- `client_id` - Client identifier from extension (optional)
- `session_id` - Browser session
- `timestamp` - Event time
- `user_agent` - Browser info
- `event_type` - Event type
- `data` - Event data (JSONB)
- `created_at` - Insert time

---

## 📊 Performance

### Simple Mode
- **Throughput**: ~50,000 req/s
- **Latency**: <1ms
- **Memory**: ~50MB base
- **Storage**: In-memory (1000 logs max)

### Production Mode
- **Throughput**: ~10,000 req/s
- **Latency**: <10ms
- **Memory**: ~100MB base
- **Storage**: PostgreSQL (unlimited)

---

## 🔧 Configuration Examples

### Development
```bash
cargo run -- --mode simple --port 8080
```

### Testing
```bash
cargo run -- --mode simple --host 0.0.0.0 --port 3000
```

### Production (Local)
```bash
cargo run --features production -- \
  --mode production \
  --database-url "postgresql://localhost/network_logger"
```

### Production (Remote)
```bash
cargo run --features production -- \
  --mode production \
  --host 0.0.0.0 \
  --port 8080 \
  --database-url "postgresql://user:pass@db.example.com/network_logger" \
  --redis-url "redis://redis.example.com:6379"
```

---

## 🐛 Troubleshooting

### "Production mode not available"
```bash
cargo build --features production
```

### "Database connection failed"
```bash
pg_isready
psql -l | grep network_logger
psql network_logger < schema.sql
```

### "Port already in use"
```bash
cargo run -- --port 3000
```

### Invalid gzip / decompression errors
- The server does **not** return 400 on gzip decompression failure; it logs a warning and treats the body as plain UTF-8 JSON.
- Ensure the client sends valid gzip when `Content-Encoding: gzip` is set, or send uncompressed JSON without that header.

---

## 🎓 When to Use Each Mode

### Use Simple Mode When:
- Testing extension locally
- Development
- Quick demos
- No persistence needed
- Single user

### Use Production Mode When:
- Multiple users
- Persistent storage needed
- Analytics or retention by `client_id`
- High volume (1000+ req/min)

---

## 🔒 Security Notes

### Simple Mode
- No authentication (testing only)
- Data in memory (not persistent)
- CORS permissive

### Production Mode
- Add authentication for blocklist updates
- Use HTTPS in production
- Configure CORS appropriately
- Set up PostgreSQL authentication
- Use environment variables for secrets

---

## 📦 Dependencies

### Always Required
- `actix-web` - Web framework
- `actix-cors` - CORS support
- `serde` - Serialization
- `tokio` - Async runtime
- `clap` - CLI parsing
- `flate2` - Gzip decompression

### Production Mode Only
- `sqlx` - PostgreSQL driver
- `redis` - Redis client (optional)
- `uuid` - UUID generation

---

## 📂 Server Structure

```
server/
├── src/
│   ├── main.rs           # CLI, routing
│   ├── handlers/         # Dashboard, logs, blocklist, extensions
│   ├── packet_id.rs      # Unique packet ID generation
│   ├── simple.rs         # In-memory state
│   ├── production.rs     # DB state (feature-gated)
│   └── types.rs          # Shared data structures
├── static/
│   ├── dashboard.html    # Embedded dashboard UI
│   └── logo.png          # CanIGoIn logo
└── schema.sql
```

## ✅ Summary

| Feature           | Simple | Production |
|-------------------|--------|------------|
| Database          | In-memory | PostgreSQL |
| Storage           | Last 1000 logs | Unlimited |
| client_id         | Accepted, not persisted | Stored in logs & extension_events |
| Dashboard         | ✅ Full UI | ✅ Full UI |
| packet_id         | ✅ Unique per event | ✅ Unique per event |
| Gzip              | ✅ Decompress on POST | ✅ Decompress on POST |
| /api/security     | ✅     | ✅         |
| Setup             | Zero config | DB required |
| Use Case          | Dev/Test | Production |

---

**Start with Simple mode for testing, switch to Production when ready!** 🚀
