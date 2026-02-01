use crate::handlers::common::{decompress_body_if_needed, get_client_ip};
use crate::simple;
use crate::types::LogEntry;
use actix_web::{web, HttpResponse, Responder};
use std::collections::HashSet;

#[cfg(feature = "production")]
use crate::production;

pub async fn post_logs_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    body: web::Bytes,
) -> impl Responder {
    let client_ip = get_client_ip(&req);

    let body_str = match decompress_body_if_needed(&req, &body) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let log_entry: LogEntry = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse log entry JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    if log_entry.session_id.is_empty() {
        log::warn!("⚠️ Received log entry with empty session_id from IP: {}", client_ip);
    }
    if log_entry.user_agent.is_empty() {
        log::warn!("⚠️ Received log entry with empty user_agent from IP: {}", client_ip);
    }

    log::info!(
        "📥 Received log entry from IP {}: session_id={}, logs_count={}, user_agent={}, timestamp={}",
        client_ip,
        log_entry.session_id,
        log_entry.logs.len(),
        log_entry.user_agent,
        log_entry.timestamp
    );

    if log_entry.logs.is_empty() {
        log::warn!("⚠️ Received log entry with empty logs array from IP: {}", client_ip);
        return HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Logs stored (empty batch)",
            "logs_count": 0,
            "client_ip": client_ip
        }));
    }

    let mut blocked_count = 0;
    let mut unique_urls = HashSet::new();

    for (idx, network_log) in log_entry.logs.iter().enumerate() {
        if network_log.url.is_empty() {
            log::warn!("⚠️ Log[{}] from IP {}: Empty URL detected", idx, client_ip);
        }
        unique_urls.insert(network_log.url.clone());
        log::debug!(
            "  Log[{}] from IP {}: request_id={}, url={}, method={}, type={}, blocked={}, block_reason={:?}",
            idx, client_ip, network_log.request_id, network_log.url, network_log.method,
            network_log.request_type, network_log.blocked, network_log.block_reason
        );
        if network_log.blocked {
            blocked_count += 1;
            log::warn!(
                "🚫 BLOCKED REQUEST from IP {}: url={}, reason={:?}",
                client_ip,
                network_log.url,
                network_log.block_reason
            );
        }
        if network_log.request_type == "main_frame" {
            log::info!(
                "🌐 PAGE NAVIGATION from IP {}: url={}, method={}",
                client_ip,
                network_log.url,
                network_log.method
            );
        }
    }

    let logs_count = log_entry.logs.len();
    log::info!(
        "📊 Batch summary from IP {}: total={}, blocked={}, unique_urls={}",
        client_ip,
        logs_count,
        blocked_count,
        unique_urls.len()
    );

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
pub async fn post_logs_production(
    req: actix_web::HttpRequest,
    data: web::Data<production::ProductionState>,
    body: web::BytesMut,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let body_bytes = body.freeze();

    let body_str = match decompress_body_if_needed(&req, &body_bytes) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let log_entry: LogEntry = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse log entry JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    log::info!(
        "📥 Received log entry from IP {}: session_id={}, logs_count={}",
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

pub async fn get_logs_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
) -> impl Responder {
    let client_ip = get_client_ip(&req);
    let logs = data.get_logs();
    log::info!("📊 Logs requested from IP {}: {} entries", client_ip, logs.len());
    HttpResponse::Ok().json(logs)
}
