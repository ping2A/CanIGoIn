use actix_web::HttpRequest;

pub fn get_client_ip(req: &HttpRequest) -> String {
    if let Some(peer_addr) = req.peer_addr() {
        return peer_addr.ip().to_string();
    }
    if let Some(forwarded_for) = req.headers().get("x-forwarded-for") {
        if let Ok(forwarded_str) = forwarded_for.to_str() {
            if let Some(first_ip) = forwarded_str.split(',').next() {
                return first_ip.trim().to_string();
            }
        }
    }
    if let Some(real_ip) = req.headers().get("x-real-ip") {
        if let Ok(real_ip_str) = real_ip.to_str() {
            return real_ip_str.to_string();
        }
    }
    "unknown".to_string()
}

pub fn decompress_body_if_needed(
    req: &HttpRequest,
    body: &actix_web::web::Bytes,
) -> Result<String, actix_web::HttpResponse> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    let content_encoding = req
        .headers()
        .get("content-encoding")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    if content_encoding == "gzip" {
        let mut decoder = GzDecoder::new(&body[..]);
        let mut decompressed = String::new();
        match decoder.read_to_string(&mut decompressed) {
            Ok(_) => Ok(decompressed),
            Err(e) => {
                log::warn!(
                    "Failed to decompress gzip body ({}). Falling back to plain body.",
                    e
                );
                Ok(String::from_utf8_lossy(&body).to_string())
            }
        }
    } else {
        Ok(String::from_utf8_lossy(&body).to_string())
    }
}
