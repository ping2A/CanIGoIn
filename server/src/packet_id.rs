use std::sync::atomic::{AtomicU64, Ordering};

static SECURITY_PACKET_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn next_packet_id() -> String {
    let n = SECURITY_PACKET_COUNTER.fetch_add(1, Ordering::SeqCst);
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    format!("sec-{}-{}", ts, n)
}
