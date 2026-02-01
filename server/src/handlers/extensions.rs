use crate::handlers::common::{decompress_body_if_needed, get_client_ip};
use crate::packet_id;
use crate::simple;
use crate::types::ExtensionEvent;
use actix_web::{web, HttpResponse, Responder};

#[cfg(feature = "production")]
use crate::production;

fn insert_packet_and_category(
    mut event: ExtensionEvent,
    packet_id: &str,
    category: &str,
) -> ExtensionEvent {
    match event.data {
        serde_json::Value::Object(ref mut obj) => {
            obj.insert("packet_id".to_string(), serde_json::Value::String(packet_id.to_string()));
            obj.insert("category".to_string(), serde_json::Value::String(category.to_string()));
        }
        other => {
            let mut obj = serde_json::Map::new();
            obj.insert("packet_id".to_string(), serde_json::Value::String(packet_id.to_string()));
            obj.insert("category".to_string(), serde_json::Value::String(category.to_string()));
            obj.insert("data".to_string(), other);
            event.data = serde_json::Value::Object(obj);
        }
    }
    event
}

pub async fn post_extensions_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    body: web::Bytes,
) -> impl Responder {
    let client_ip = get_client_ip(&req);

    let body_str = match decompress_body_if_needed(&req, &body) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let extension_event: ExtensionEvent = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse extension event JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    log::info!(
        "📦 Received extension event from IP {}: session_id={}, event_type={}, user_agent={}",
        client_ip,
        extension_event.session_id,
        extension_event.event_type,
        extension_event.user_agent
    );
    log::debug!("  Event data from IP {}: {:?}", client_ip, extension_event.data);

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
            log::info!(
                "📦 Extension event from IP {}: type={} data={:?}",
                client_ip,
                extension_event.event_type,
                extension_event.data
            );
        }
    }

    let category = if extension_event.event_type == "javascript_execution" {
        "javascript"
    } else {
        "general"
    };
    let packet_id = packet_id::next_packet_id();
    let extension_event = insert_packet_and_category(extension_event, &packet_id, category);
    data.add_extension_event(extension_event);

    log::info!(
        "✅ Extension event stored successfully from IP {} (packet_id={})",
        client_ip,
        packet_id
    );
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Extension event stored",
        "packet_id": packet_id,
        "client_ip": client_ip
    }))
}

pub async fn post_security_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
    body: web::Bytes,
) -> impl Responder {
    let client_ip = get_client_ip(&req);

    let body_str = match decompress_body_if_needed(&req, &body) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let security_event: ExtensionEvent = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("🔒 SECURITY Failed to parse security event JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    let packet_id = packet_id::next_packet_id();
    let security_event = insert_packet_and_category(security_event, &packet_id, "security");

    log::info!("🔒 SECURITY ─────────── NEW PACKET ───────────");
    log::info!("🔒 SECURITY \tpacket_id:    {}", packet_id);
    log::info!("🔒 SECURITY \tIP:           {}", client_ip);
    log::info!("🔒 SECURITY \tsession_id:   {}", security_event.session_id);
    log::info!("🔒 SECURITY \tevent_type:   {}", security_event.event_type);
    log::info!("🔒 SECURITY \tuser_agent:   {}", security_event.user_agent);

    if security_event.event_type == "chatgpt_file_upload" {
        let file_name = security_event
            .data
            .get("file_name")
            .and_then(|v| v.as_str())
            .unwrap_or("(none)");
        log::info!("🔒 SECURITY \tfile_name:    {}", file_name);
        if let Some(payload) = security_event.data.get("payload") {
            if let Some(obj) = payload.as_object() {
                for (k, v) in obj {
                    log::info!("🔒 SECURITY \t  payload.{}: {}", k, v);
                }
            } else {
                log::info!("🔒 SECURITY \tpayload:      {:?}", payload);
            }
        }
    } else {
        log::info!("🔒 SECURITY \tdata:         {:?}", security_event.data);
    }

    data.add_extension_event(security_event);

    log::info!("🔒 SECURITY \t→ RESULT:     stored");
    log::info!("🔒 SECURITY ───────────────────────────────────");
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Security event stored",
        "packet_id": packet_id,
        "client_ip": client_ip
    }))
}

#[cfg(feature = "production")]
pub async fn post_extensions_production(
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

    let extension_event: ExtensionEvent = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse extension event JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    log::info!(
        "📦 Received extension event from IP {}: session_id={}, event_type={}",
        client_ip,
        extension_event.session_id,
        extension_event.event_type
    );

    let category = if extension_event.event_type == "javascript_execution" {
        "javascript"
    } else {
        "general"
    };
    let packet_id = packet_id::next_packet_id();
    let extension_event = insert_packet_and_category(extension_event, &packet_id, category);

    match data.add_extension_event(extension_event).await {
        Ok(_) => {
            log::info!(
                "✅ Extension event stored successfully from IP {} (packet_id={})",
                client_ip,
                packet_id
            );
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Extension event stored",
                "packet_id": packet_id,
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

#[cfg(feature = "production")]
pub async fn post_security_production(
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

    let security_event: ExtensionEvent = match serde_json::from_str(&body_str) {
        Ok(e) => e,
        Err(e) => {
            log::error!("🔒 SECURITY Failed to parse security event JSON: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid JSON: {}", e)
            }));
        }
    };

    let packet_id = packet_id::next_packet_id();
    let security_event = insert_packet_and_category(security_event, &packet_id, "security");

    log::info!("🔒 SECURITY ─────────── NEW PACKET ───────────");
    log::info!("🔒 SECURITY \tpacket_id:    {}", packet_id);
    log::info!("🔒 SECURITY \tIP:           {}", client_ip);
    log::info!("🔒 SECURITY \tsession_id:   {}", security_event.session_id);
    log::info!("🔒 SECURITY \tevent_type:   {}", security_event.event_type);

    if security_event.event_type == "chatgpt_file_upload" {
        let file_name = security_event
            .data
            .get("file_name")
            .and_then(|v| v.as_str())
            .unwrap_or("(none)");
        log::info!("🔒 SECURITY \tfile_name:    {}", file_name);
        if let Some(payload) = security_event.data.get("payload") {
            if let Some(obj) = payload.as_object() {
                for (k, v) in obj {
                    log::info!("🔒 SECURITY \t  payload.{}: {}", k, v);
                }
            } else {
                log::info!("🔒 SECURITY \tpayload:      {:?}", payload);
            }
        }
    } else {
        log::info!("🔒 SECURITY \tdata:         {:?}", security_event.data);
    }

    match data.add_extension_event(security_event).await {
        Ok(_) => {
            log::info!("🔒 SECURITY \t→ RESULT:     stored");
            log::info!("🔒 SECURITY ───────────────────────────────────");
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Security event stored",
                "packet_id": packet_id,
                "client_ip": client_ip
            }))
        }
        Err(e) => {
            log::error!("🔒 SECURITY \t→ RESULT:     error - {}", e);
            log::info!("🔒 SECURITY ───────────────────────────────────");
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e),
                "client_ip": client_ip
            }))
        }
    }
}
