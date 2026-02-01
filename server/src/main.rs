mod handlers;
mod packet_id;
mod simple;

#[cfg(feature = "production")]
mod production;

mod types;

use actix_cors::Cors;
use actix_web::{web, App, HttpResponse, HttpServer};
use clap::{Parser, ValueEnum};

#[derive(Debug, Clone, ValueEnum)]
enum ServerMode {
    Simple,
    Production,
}

#[derive(Parser, Debug)]
#[command(name = "network-logger-server")]
#[command(about = "Network logging server with simple and production modes", long_about = None)]
struct Args {
    #[arg(short, long, value_enum, default_value = "simple")]
    mode: ServerMode,

    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    #[arg(short, long, default_value = "8080")]
    port: u16,

    #[arg(long)]
    database_url: Option<String>,

    #[arg(long)]
    redis_url: Option<String>,
}

async fn health_check(req: actix_web::HttpRequest) -> impl actix_web::Responder {
    let client_ip = handlers::common::get_client_ip(&req);
    log::debug!("🏥 Health check requested from IP: {}", client_ip);
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "client_ip": client_ip
    }))
}

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
            log::info!("📊 Dashboard: http://{}/", bind_address);
            log::info!(
                "📝 Logging level: {}",
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string())
            );

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
                            })),
                        )
                        .into()
                    }))
                    .route("/", web::get().to(handlers::dashboard::serve_dashboard))
                    .route("/dashboard", web::get().to(handlers::dashboard::serve_dashboard))
                    .route("/logo.png", web::get().to(handlers::dashboard::serve_logo))
                    .route("/health", web::get().to(health_check))
                    .route("/api/logs", web::post().to(handlers::logs::post_logs_simple))
                    .route("/api/logs", web::get().to(handlers::logs::get_logs_simple))
                    .route("/api/blocklist", web::get().to(handlers::blocklist::get_blocklist_simple))
                    .route("/api/blocklist", web::post().to(handlers::blocklist::post_blocklist_simple))
                    .route(
                        "/api/dashboard/events",
                        web::get().to(handlers::dashboard::get_dashboard_events_simple),
                    )
                    .route(
                        "/api/dashboard/events/{packet_id}",
                        web::get().to(handlers::dashboard::get_dashboard_packet_simple),
                    )
                    .route(
                        "/api/dashboard/clients",
                        web::get().to(handlers::dashboard::get_dashboard_clients_simple),
                    )
                    .route(
                        "/api/extensions",
                        web::post().to(handlers::extensions::post_extensions_simple),
                    )
                    .route(
                        "/api/security",
                        web::post().to(handlers::extensions::post_security_simple),
                    )
            })
            .bind(&bind_address)?
            .run()
            .await
        }
        #[cfg(feature = "production")]
        ServerMode::Production => {
            log::info!("🚀 Starting server in PRODUCTION mode");

            let database_url = args
                .database_url
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
                    .route("/", web::get().to(handlers::dashboard::serve_dashboard))
                    .route("/dashboard", web::get().to(handlers::dashboard::serve_dashboard))
                    .route("/logo.png", web::get().to(handlers::dashboard::serve_logo))
                    .route("/health", web::get().to(health_check))
                    .route("/api/logs", web::post().to(handlers::logs::post_logs_production))
                    .route(
                        "/api/blocklist",
                        web::get().to(handlers::blocklist::get_blocklist_production),
                    )
                    .route(
                        "/api/blocklist",
                        web::post().to(handlers::blocklist::post_blocklist_production),
                    )
                    .route(
                        "/api/extensions",
                        web::post().to(handlers::extensions::post_extensions_production),
                    )
                    .route(
                        "/api/security",
                        web::post().to(handlers::extensions::post_security_production),
                    )
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
