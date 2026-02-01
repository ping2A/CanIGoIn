use crate::handlers::common::get_client_ip;
use crate::simple;
use actix_web::{web, HttpResponse, Responder};

fn domain_from_url(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let rest = if let Some(pos) = s.find("://") {
        &s[pos + 3..]
    } else {
        s
    };
    let host = rest.split(&['/', '?', '#'][..]).next().unwrap_or(rest);
    let domain = host.split(':').next().unwrap_or(host).trim();
    if domain.is_empty() {
        None
    } else {
        Some(domain.to_string())
    }
}

fn extract_domains(data: &serde_json::Value) -> (String, String) {
    let page_domain = data
        .get("url")
        .and_then(|v| v.as_str())
        .and_then(domain_from_url)
        .or_else(|| data.get("host").and_then(|v| v.as_str()).and_then(domain_from_url))
        .unwrap_or_default();
    let script_domain = data
        .get("scriptUrl")
        .and_then(|v| v.as_str())
        .and_then(domain_from_url)
        .unwrap_or_default();
    (page_domain, script_domain)
}

pub async fn get_dashboard_events_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
) -> impl Responder {
    let _client_ip = get_client_ip(&req);
    let filter = req
        .query_string()
        .split('&')
        .find_map(|p| {
            let (k, v) = p.split_once('=')?;
            if k == "filter" { Some(v) } else { None }
        })
        .unwrap_or("all");

    let events = data.get_extension_events();
    let mut out: Vec<serde_json::Value> = Vec::with_capacity(events.len());

    for (i, e) in events.iter().rev().enumerate() {
        let category = e
            .data
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("general");

        let matches_filter = match filter {
            "security" => category == "security",
            "javascript" => category == "javascript",
            _ => true,
        };
        if !matches_filter {
            continue;
        }

        let packet_id = e
            .data
            .get("packet_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let packet_id = if packet_id.is_empty() {
            format!("evt-{}", i)
        } else {
            packet_id
        };
        let (page_domain, script_domain) = extract_domains(&e.data);
        out.push(serde_json::json!({
            "packet_id": packet_id,
            "event_type": e.event_type,
            "category": category,
            "page_domain": page_domain,
            "script_domain": script_domain,
            "client_id": e.client_id,
            "session_id": e.session_id,
            "timestamp": e.timestamp,
            "user_agent": e.user_agent,
        }));
    }

    HttpResponse::Ok().json(serde_json::json!({ "events": out }))
}

pub async fn get_dashboard_packet_simple(
    path: web::Path<String>,
    data: web::Data<simple::SimpleState>,
) -> impl Responder {
    let packet_id = path.into_inner();
    let events = data.get_extension_events();

    if let Some(stripped) = packet_id.strip_prefix("evt-") {
        if let Ok(idx) = stripped.parse::<usize>() {
            if idx < events.len() {
                let rev_idx = events.len() - 1 - idx;
                if let Some(e) = events.get(rev_idx) {
                    return HttpResponse::Ok().json(e);
                }
            }
        }
    }

    for e in events.iter().rev() {
        if e.data
            .get("packet_id")
            .and_then(|v| v.as_str())
            == Some(packet_id.as_str())
        {
            return HttpResponse::Ok().json(e);
        }
    }

    HttpResponse::NotFound().json(serde_json::json!({
        "error": "packet not found",
        "packet_id": packet_id
    }))
}

pub async fn get_dashboard_clients_simple(
    req: actix_web::HttpRequest,
    data: web::Data<simple::SimpleState>,
) -> impl Responder {
    let _client_ip = get_client_ip(&req);
    let events = data.get_extension_events();
    let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in events.iter() {
        if let Some(ref cid) = e.client_id {
            if !cid.is_empty() {
                ids.insert(cid.clone());
            }
        }
    }
    let list: Vec<String> = ids.into_iter().collect();
    HttpResponse::Ok().json(serde_json::json!({ "clients": list }))
}

pub async fn serve_dashboard() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(include_str!("../../static/dashboard.html"))
}
