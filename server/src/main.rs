use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use actix_cors::Cors;
use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, ValueEnum)]
enum ServerMode {
    Simple,
    Production,
}

#[derive(Parser, Debug)]
#[command(name = "network-logger-server")]
#[command(about = "Network logging server with simple and production modes", long_about = None)]
struct Args {
    /// Server mode: simple or production
    #[arg(short, long, value_enum, default_value = "simple")]
    mode: ServerMode,

    /// Server host
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Server port
    #[arg(short, long, default_value = "8080")]
    port: u16,

    /// Database URL (production mode only)
    #[arg(long)]
    database_url: Option<String>,

    /// Redis URL (production mode only)
    #[arg(long)]
    redis_url: Option<String>,
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LogEntry {
    #[serde(default)]
    client_id: Option<String>,
    session_id: String,
    timestamp: String,
    user_agent: String,
    logs: Vec<NetworkLog>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct NetworkLog {
    #[serde(rename = "requestId", default = "default_string")]
    request_id: String,
    url: String,
    method: String,
    #[serde(rename = "type", default = "default_request_type")]
    request_type: String,
    #[serde(default)]
    blocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    block_reason: Option<String>,
}

fn default_string() -> String {
    String::new()
}

fn default_request_type() -> String {
    "other".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Blocklist {
    #[serde(rename = "urlPatterns")]
    url_patterns: Vec<String>,
    #[serde(rename = "youtubeChannels")]
    youtube_channels: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExtensionEvent {
    #[serde(default)]
    client_id: Option<String>,
    session_id: String,
    timestamp: String,
    user_agent: String,
    event_type: String,
    data: serde_json::Value,
}

// ============================================================================
// Simple Mode - In-Memory Storage
// ============================================================================

mod simple {
    use super::*;
    use std::sync::Mutex;

    pub struct SimpleState {
        logs: Mutex<Vec<LogEntry>>,
        blocklist: Mutex<Blocklist>,
        extension_events: Mutex<Vec<ExtensionEvent>>,
    }

    impl SimpleState {
        pub fn new() -> Self {
            SimpleState {
                logs: Mutex::new(Vec::new()),
                blocklist: Mutex::new(Blocklist {
                    url_patterns: vec![
                        ".*tracker\\..*".to_string(),
                        ".*analytics\\..*".to_string(),
                        ".*doubleclick\\..*".to_string(),
                    ],
                    youtube_channels: vec![
                        "@spam".to_string(),
                    ],
                }),
                extension_events: Mutex::new(Vec::new()),
            }
        }

        pub fn add_log(&self, entry: LogEntry) {
            let mut logs = self.logs.lock().unwrap();
            logs.push(entry);
            
            // Keep only last 1000 entries to prevent memory issues
            if logs.len() > 1000 {
                let len = logs.len();
                logs.drain(0..len - 1000);
            }
        }

        pub fn get_logs(&self) -> Vec<LogEntry> {
            self.logs.lock().unwrap().clone()
        }

        pub fn get_blocklist(&self) -> Blocklist {
            (*self.blocklist.lock().unwrap()).clone()
        }

        pub fn update_blocklist(&self, blocklist: Blocklist) {
            *self.blocklist.lock().unwrap() = blocklist;
        }

        pub fn add_extension_event(&self, event: ExtensionEvent) {
            let mut events = self.extension_events.lock().unwrap();
            events.push(event);
            
            // Keep only last 500 events
            if events.len() > 500 {
                let len = events.len();
                events.drain(0..len - 500);
            }
        }
    }
}

// ============================================================================
// Production Mode - Database Storage
// ============================================================================

#[cfg(feature = "production")]
mod production {
    use super::*;
    use sqlx::{PgPool, postgres::PgPoolOptions};
    use redis::Client as RedisClient;

    pub struct ProductionState {
        db_pool: PgPool,
        redis_client: Option<RedisClient>,
    }

    impl ProductionState {
        pub async fn new(database_url: &str, redis_url: Option<&str>) -> Result<Self, Box<dyn std::error::Error>> {
            let db_pool = PgPoolOptions::new()
                .max_connections(20)
                .connect(database_url)
                .await?;

            let redis_client = if let Some(url) = redis_url {
                Some(RedisClient::open(url)?)
            } else {
                None
            };

            Ok(ProductionState {
                db_pool,
                redis_client,
            })
        }

        pub async fn add_log(&self, entry: LogEntry) -> Result<(), sqlx::Error> {
            for log in &entry.logs {
                sqlx::query!(
                    r#"
                    INSERT INTO network_logs 
                    (client_id, session_id, timestamp, user_agent, request_id, url, method, request_type, blocked, block_reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    "#,
                    entry.client_id,
                    entry.session_id,
                    entry.timestamp,
                    entry.user_agent,
                    log.request_id,
                    log.url,
                    log.method,
                    log.request_type,
                    log.blocked,
                    log.block_reason
                )
                .execute(&self.db_pool)
                .await?;
            }
            Ok(())
        }

        pub async fn get_blocklist(&self) -> Result<Blocklist, sqlx::Error> {
            let url_patterns: Vec<String> = sqlx::query_scalar!(
                "SELECT pattern FROM blocklist_patterns WHERE type = 'url' AND active = true"
            )
            .fetch_all(&self.db_pool)
            .await?;

            let youtube_channels: Vec<String> = sqlx::query_scalar!(
                "SELECT pattern FROM blocklist_patterns WHERE type = 'youtube' AND active = true"
            )
            .fetch_all(&self.db_pool)
            .await?;

            Ok(Blocklist {
                url_patterns,
                youtube_channels,
            })
        }

        pub async fn update_blocklist(&self, blocklist: Blocklist) -> Result<(), sqlx::Error> {
            // Deactivate all existing patterns
            sqlx::query!("UPDATE blocklist_patterns SET active = false")
                .execute(&self.db_pool)
                .await?;

            // Insert new patterns
            for pattern in blocklist.url_patterns {
                sqlx::query!(
                    "INSERT INTO blocklist_patterns (pattern, type) VALUES ($1, 'url') ON CONFLICT (pattern) DO UPDATE SET active = true",
                    pattern
                )
                .execute(&self.db_pool)
                .await?;
            }

            for channel in blocklist.youtube_channels {
                sqlx::query!(
                    "INSERT INTO blocklist_patterns (pattern, type) VALUES ($1, 'youtube') ON CONFLICT (pattern) DO UPDATE SET active = true",
                    channel
                )
                .execute(&self.db_pool)
                .await?;
            }

            Ok(())
        }

        pub async fn add_extension_event(&self, event: ExtensionEvent) -> Result<(), sqlx::Error> {
            sqlx::query!(
                r#"
                INSERT INTO extension_events 
                (client_id, session_id, timestamp, user_agent, event_type, data)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
                event.client_id,
                event.session_id,
                event.timestamp,
                event.user_agent,
                event.event_type,
                event.data
            )
            .execute(&self.db_pool)
            .await?;
            Ok(())
        }
    }
}

// ============================================================================
// HTTP Handlers
// ============================================================================

// Helper function to extract client IP from request
fn get_client_ip(req: &actix_web::HttpRequest) -> String {
    // Try to get IP from connection info first (most reliable)
    if let Some(peer_addr) = req.peer_addr() {
        return peer_addr.ip().to_string();
    }
    
    // Try X-Forwarded-For header (for proxies/load balancers)
    if let Some(forwarded_for) = req.headers().get("x-forwarded-for") {
        if let Ok(forwarded_str) = forwarded_for.to_str() {
            // X-Forwarded-For can contain multiple IPs, take the first one
            if let Some(first_ip) = forwarded_str.split(',').next() {
                return first_ip.trim().to_string();
            }
        }
    }
    
    // Try X-Real-IP header (common in nginx)
    if let Some(real_ip) = req.headers().get("x-real-ip") {
        if let Ok(real_ip_str) = real_ip.to_str() {
            return real_ip_str.to_string();
        }
    }
    
    // Fallback to "unknown"
    "unknown".to_string()
}

async fn health_check(req: actix_web::HttpRequest) -> impl Responder {
    let client_ip = get_client_ip(&req);
    log::debug!("🏥 Health check requested from IP: {}", client_ip);
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "client_ip": client_ip
    }))
}

async fn post_logs_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    entry: web::Json<LogEntry>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let log_entry = entry.into_inner();
    
    // Validate required fields
    if log_entry.session_id.is_empty() {
        log::warn!("⚠️ Received log entry with empty session_id from IP: {}", client_ip);
    }
    if log_entry.user_agent.is_empty() {
        log::warn!("⚠️ Received log entry with empty user_agent from IP: {}", client_ip);
    }
    
    // Log request details with IP
    log::info!("📥 Received log entry from IP {}: session_id={}, logs_count={}, user_agent={}, timestamp={}", 
        client_ip,
        log_entry.session_id, 
        log_entry.logs.len(),
        log_entry.user_agent,
        log_entry.timestamp
    );
    
    // Handle empty logs array gracefully
    if log_entry.logs.is_empty() {
        log::warn!("⚠️ Received log entry with empty logs array from IP: {}", client_ip);
        return HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Logs stored (empty batch)",
            "logs_count": 0,
            "client_ip": client_ip
        }));
    }
    
    // Log individual network logs with more detail
    let mut blocked_count = 0;
    let mut unique_urls = HashSet::new();
    
    for (idx, network_log) in log_entry.logs.iter().enumerate() {
        // Validate network log fields
        if network_log.url.is_empty() {
            log::warn!("⚠️ Log[{}] from IP {}: Empty URL detected", idx, client_ip);
        }
        
        unique_urls.insert(network_log.url.clone());
        
        log::debug!("  Log[{}] from IP {}: request_id={}, url={}, method={}, type={}, blocked={}, block_reason={:?}",
            idx,
            client_ip,
            network_log.request_id,
            network_log.url,
            network_log.method,
            network_log.request_type,
            network_log.blocked,
            network_log.block_reason
        );
        
        // Log blocked requests at info level
        if network_log.blocked {
            blocked_count += 1;
            log::warn!("🚫 BLOCKED REQUEST from IP {}: url={}, reason={:?}", 
                client_ip,
                network_log.url, 
                network_log.block_reason
            );
        }
        
        // Log main_frame requests (page navigations) at info level for visibility
        if network_log.request_type == "main_frame" {
            log::info!("🌐 PAGE NAVIGATION from IP {}: url={}, method={}", 
                client_ip,
                network_log.url,
                network_log.method
            );
        }
    }
    
    // Summary logging
    let logs_count = log_entry.logs.len();
    log::info!("📊 Batch summary from IP {}: total={}, blocked={}, unique_urls={}", 
        client_ip,
        logs_count,
        blocked_count,
        unique_urls.len()
    );
    
    // Store the logs
    data.add_log(log_entry);
    
    log::info!("✅ Logs stored successfully from IP: {}", client_ip);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Logs stored",
        "logs_count": logs_count,
        "blocked_count": blocked_count,
        "unique_urls": unique_urls.len(),
        "client_ip": client_ip
    }))
}

#[cfg(feature = "production")]
async fn post_logs_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    entry: web::Json<LogEntry>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let log_entry = entry.into_inner();
    
    log::info!("📥 Received log entry from IP {}: session_id={}, logs_count={}", 
        client_ip,
        log_entry.session_id,
        log_entry.logs.len()
    );
    
    match data.add_log(log_entry).await {
        Ok(_) => {
            log::info!("✅ Logs stored successfully from IP: {}", client_ip);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Logs stored",
                "client_ip": client_ip
            }))
        },
        Err(e) => {
            log::error!("❌ Database error from IP {}: {}", client_ip, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}

async fn get_logs_simple(req: actix_web::HttpRequest, data: web::Data<simple::SimpleState>) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let logs = data.get_logs();
    log::info!("📊 Logs requested from IP {}: {} entries", client_ip, logs.len());
    HttpResponse::Ok().json(logs)
}

async fn get_blocklist_simple(req: actix_web::HttpRequest, data: web::Data<simple::SimpleState>) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let blocklist = data.get_blocklist();
    log::info!("📋 Blocklist requested from IP {}: {} URL patterns, {} YouTube channels",
        client_ip,
        blocklist.url_patterns.len(),
        blocklist.youtube_channels.len()
    );
    HttpResponse::Ok().json(blocklist)
}

#[cfg(feature = "production")]
async fn get_blocklist_production(req: actix_web::HttpRequest, data: web::Data<production::ProductionState>) -> impl Responder {
    let client_ip = get_client_ip(&req);
    log::info!("📋 Blocklist requested from IP: {}", client_ip);
    
    match data.get_blocklist().await {
        Ok(blocklist) => HttpResponse::Ok().json(blocklist),
        Err(e) => {
            log::error!("❌ Database error from IP {}: {}", client_ip, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}

async fn post_blocklist_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let new_blocklist = blocklist.into_inner();
    
    log::info!("📝 Blocklist update requested from IP {}: {} URL patterns, {} YouTube channels",
        client_ip,
        new_blocklist.url_patterns.len(),
        new_blocklist.youtube_channels.len()
    );
    
    // Log patterns for debugging
    for (idx, pattern) in new_blocklist.url_patterns.iter().enumerate() {
        log::debug!("  URL pattern[{}] from IP {}: {}", idx, client_ip, pattern);
    }
    for (idx, channel) in new_blocklist.youtube_channels.iter().enumerate() {
        log::debug!("  YouTube channel[{}] from IP {}: {}", idx, client_ip, channel);
    }
    
    data.update_blocklist(new_blocklist);
    
    log::info!("✅ Blocklist updated successfully by IP: {}", client_ip);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Blocklist updated",
        "client_ip": client_ip
    }))
}

#[cfg(feature = "production")]
async fn post_blocklist_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let new_blocklist = blocklist.into_inner();
    
    log::info!("📝 Blocklist update requested from IP {}: {} URL patterns, {} YouTube channels",
        client_ip,
        new_blocklist.url_patterns.len(),
        new_blocklist.youtube_channels.len()
    );
    
    match data.update_blocklist(new_blocklist).await {
        Ok(_) => {
            log::info!("✅ Blocklist updated successfully by IP: {}", client_ip);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Blocklist updated",
                "client_ip": client_ip
            }))
        },
        Err(e) => {
            log::error!("❌ Database error from IP {}: {}", client_ip, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}

async fn post_extensions_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let extension_event = event.into_inner();
    
    // Log extension event details with IP
    log::info!("📦 Received extension event from IP {}: session_id={}, event_type={}, user_agent={}",
        client_ip,
        extension_event.session_id,
        extension_event.event_type,
        extension_event.user_agent
    );
    
    // Log event data
    log::debug!("  Event data from IP {}: {:?}", client_ip, extension_event.data);
    
    // Log all event types at visible level so examples and tests are easy to verify
    match extension_event.event_type.as_str() {
        "extension_installed" => {
            log::warn!("🆕 EXTENSION INSTALLED from IP {}: {:?}", client_ip, extension_event.data);
        }
        "extension_uninstalled" => {
            log::warn!("🗑️ EXTENSION UNINSTALLED from IP {}: {:?}", client_ip, extension_event.data);
        }
        "clickfix_detection" => {
            log::error!("🚨 CLICKFIX DETECTED from IP {}: {:?}", client_ip, extension_event.data);
        }
        "javascript_execution" => {
            log::info!("📜 JS EXECUTION from IP {}: {:?}", client_ip, extension_event.data);
        }
        _ => {
            log::info!("📦 Extension event from IP {}: type={} data={:?}", client_ip, extension_event.event_type, extension_event.data);
        }
    }
    
    data.add_extension_event(extension_event);
    
    log::info!("✅ Extension event stored successfully from IP: {}", client_ip);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Extension event stored",
        "client_ip": client_ip
    }))
}

// Security endpoint: same payload as /api/extensions, but used for security-related events
async fn post_security_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let security_event = event.into_inner();

    log::info!(
        "🔐 Received security event from IP {}: session_id={}, event_type={}, user_agent={}",
        client_ip,
        security_event.session_id,
        security_event.event_type,
        security_event.user_agent
    );

    // Security events are important: log payload at info.
    log::info!("  Security event data from IP {}: {:?}", client_ip, security_event.data);

    data.add_extension_event(security_event);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Security event stored",
        "client_ip": client_ip
    }))
}

#[cfg(feature = "production")]
async fn post_extensions_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let extension_event = event.into_inner();
    
    log::info!("📦 Received extension event from IP {}: session_id={}, event_type={}",
        client_ip,
        extension_event.session_id,
        extension_event.event_type
    );
    
    match data.add_extension_event(extension_event).await {
        Ok(_) => {
            log::info!("✅ Extension event stored successfully from IP: {}", client_ip);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Extension event stored",
                "client_ip": client_ip
            }))
        },
        Err(e) => {
            log::error!("❌ Database error from IP {}: {}", client_ip, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}

#[cfg(feature = "production")]
async fn post_security_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let security_event = event.into_inner();

    log::info!(
        "🔐 Received security event from IP {}: session_id={}, event_type={}",
        client_ip,
        security_event.session_id,
        security_event.event_type
    );

    match data.add_extension_event(security_event).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Security event stored",
            "client_ip": client_ip
        })),
        Err(e) => {
            log::error!("❌ Database error from IP {}: {}", client_ip, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}

// ============================================================================
// Main
// ============================================================================

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));
    
    let args = Args::parse();
    let bind_address = format!("{}:{}", args.host, args.port);

    match args.mode {
        ServerMode::Simple => {
            log::info!("🚀 Starting server in SIMPLE mode");
            log::info!("📦 Using in-memory storage");
            log::info!("🌐 Listening on http://{}", bind_address);
            log::info!("📝 Logging level: {}", std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()));

            let state = web::Data::new(simple::SimpleState::new());

            HttpServer::new(move || {
                let cors = Cors::permissive();

                App::new()
                    .wrap(cors)
                    .wrap(actix_web::middleware::Logger::default())
                    .app_data(state.clone())
                    .app_data(web::JsonConfig::default().error_handler(|err, _req| {
                        let error_msg = format!("{}", err);
                        log::error!("❌ JSON parsing error: {}", error_msg);
                        actix_web::error::InternalError::from_response(
                            err,
                            HttpResponse::BadRequest().json(serde_json::json!({
                                "success": false,
                                "error": format!("Invalid JSON: {}", error_msg)
                            }))
                        ).into()
                    }))
                    .route("/health", web::get().to(health_check))
                    .route("/api/logs", web::post().to(post_logs_simple))
                    .route("/api/logs", web::get().to(get_logs_simple))
                    .route("/api/blocklist", web::get().to(get_blocklist_simple))
                    .route("/api/blocklist", web::post().to(post_blocklist_simple))
                    .route("/api/extensions", web::post().to(post_extensions_simple))
                    .route("/api/security", web::post().to(post_security_simple))
            })
            .bind(&bind_address)?
            .run()
            .await
        }
        #[cfg(feature = "production")]
        ServerMode::Production => {
            log::info!("🚀 Starting server in PRODUCTION mode");

            let database_url = args.database_url
                .expect("--database-url is required for production mode");
            let redis_url = args.redis_url.as_deref();

            log::info!("🗄️  Connecting to PostgreSQL...");
            let state = production::ProductionState::new(&database_url, redis_url)
                .await
                .expect("Failed to initialize production state");
            
            log::info!("✅ Database connected");
            if redis_url.is_some() {
                log::info!("✅ Redis connected");
            }
            log::info!("🌐 Listening on http://{}", bind_address);

            let state = web::Data::new(state);

            HttpServer::new(move || {
                let cors = Cors::permissive();

                App::new()
                    .wrap(cors)
                    .app_data(state.clone())
                    .route("/health", web::get().to(health_check))
                    .route("/api/logs", web::post().to(post_logs_production))
                    .route("/api/blocklist", web::get().to(get_blocklist_production))
                    .route("/api/blocklist", web::post().to(post_blocklist_production))
                    .route("/api/extensions", web::post().to(post_extensions_production))
                    .route("/api/security", web::post().to(post_security_production))
            })
            .bind(&bind_address)?
            .run()
            .await
        }
        #[cfg(not(feature = "production"))]
        ServerMode::Production => {
            eprintln!("❌ Production mode not available. Rebuild with --features production");
            std::process::exit(1);
        }
    }
}
