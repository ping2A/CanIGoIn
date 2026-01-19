use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use actix_cors::Cors;
use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize};

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
    session_id: String,
    timestamp: String,
    user_agent: String,
    logs: Vec<NetworkLog>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct NetworkLog {
    #[serde(rename = "requestId")]
    request_id: String,
    url: String,
    method: String,
    #[serde(rename = "type")]
    request_type: String,
    blocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    block_reason: Option<String>,
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
                    (session_id, timestamp, user_agent, request_id, url, method, request_type, blocked, block_reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    "#,
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
                (session_id, timestamp, user_agent, event_type, data)
                VALUES ($1, $2, $3, $4, $5)
                "#,
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

async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

async fn post_logs_simple(
    data: web::Data<simple::SimpleState>,
    entry: web::Json<LogEntry>,
) -> impl Responder {
    data.add_log(entry.into_inner());
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Logs stored"
    }))
}

#[cfg(feature = "production")]
async fn post_logs_production(
    data: web::Data<production::ProductionState>,
    entry: web::Json<LogEntry>,
) -> impl Responder {
    match data.add_log(entry.into_inner()).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Logs stored"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        }))
    }
}

async fn get_logs_simple(data: web::Data<simple::SimpleState>) -> impl Responder {
    let logs = data.get_logs();
    HttpResponse::Ok().json(logs)
}

async fn get_blocklist_simple(data: web::Data<simple::SimpleState>) -> impl Responder {
    let blocklist = data.get_blocklist();
    HttpResponse::Ok().json(blocklist)
}

#[cfg(feature = "production")]
async fn get_blocklist_production(data: web::Data<production::ProductionState>) -> impl Responder {
    match data.get_blocklist().await {
        Ok(blocklist) => HttpResponse::Ok().json(blocklist),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Database error: {}", e)
        }))
    }
}

async fn post_blocklist_simple(
    data: web::Data<simple::SimpleState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    data.update_blocklist(blocklist.into_inner());
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Blocklist updated"
    }))
}

#[cfg(feature = "production")]
async fn post_blocklist_production(
    data: web::Data<production::ProductionState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    match data.update_blocklist(blocklist.into_inner()).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Blocklist updated"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        }))
    }
}

async fn post_extensions_simple(
    data: web::Data<simple::SimpleState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    data.add_extension_event(event.into_inner());
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Extension event stored"
    }))
}

#[cfg(feature = "production")]
async fn post_extensions_production(
    data: web::Data<production::ProductionState>,
    event: web::Json<ExtensionEvent>,
) -> impl Responder {
    match data.add_extension_event(event.into_inner()).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Extension event stored"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("Database error: {}", e)
        }))
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

            let state = web::Data::new(simple::SimpleState::new());

            HttpServer::new(move || {
                let cors = Cors::permissive();

                App::new()
                    .wrap(cors)
                    .app_data(state.clone())
                    .route("/health", web::get().to(health_check))
                    .route("/api/logs", web::post().to(post_logs_simple))
                    .route("/api/logs", web::get().to(get_logs_simple))
                    .route("/api/blocklist", web::get().to(get_blocklist_simple))
                    .route("/api/blocklist", web::post().to(post_blocklist_simple))
                    .route("/api/extensions", web::post().to(post_extensions_simple))
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
