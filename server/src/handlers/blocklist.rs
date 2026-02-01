use crate::handlers::common::get_client_ip;
use crate::simple;
use crate::types::Blocklist;
use actix_web::{web, HttpResponse, Responder};

#[cfg(feature = "production")]
use crate::production;

pub async fn get_blocklist_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let blocklist = data.get_blocklist();
    log::info!(
        "📋 Blocklist requested from IP {}: {} URL patterns, {} YouTube channels",
        client_ip,
        blocklist.url_patterns.len(),
        blocklist.youtube_channels.len()
    );
    HttpResponse::Ok().json(blocklist)
}

#[cfg(feature = "production")]
pub async fn get_blocklist_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
) -> impl Responder {
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

pub async fn post_blocklist_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let new_blocklist = blocklist.into_inner();

    log::info!(
        "📝 Blocklist update requested from IP {}: {} URL patterns, {} YouTube channels",
        client_ip,
        new_blocklist.url_patterns.len(),
        new_blocklist.youtube_channels.len()
    );

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
pub async fn post_blocklist_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    blocklist: web::Json<Blocklist>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let new_blocklist = blocklist.into_inner();

    log::info!(
        "📝 Blocklist update requested from IP {}: {} URL patterns, {} YouTube channels",
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
        }
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
