use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEntry {
    #[serde(default)]
    pub client_id: Option<String>,
    pub session_id: String,
    pub timestamp: String,
    pub user_agent: String,
    pub logs: Vec<NetworkLog>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkLog {
    #[serde(rename = "requestId", default = "default_string")]
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(rename = "type", default = "default_request_type")]
    pub request_type: String,
    #[serde(default)]
    pub blocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_reason: Option<String>,
}

pub fn default_string() -> String {
    String::new()
}

pub fn default_request_type() -> String {
    "other".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Blocklist {
    #[serde(rename = "urlPatterns")]
    pub url_patterns: Vec<String>,
    #[serde(rename = "youtubeChannels")]
    pub youtube_channels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionEvent {
    #[serde(default)]
    pub client_id: Option<String>,
    pub session_id: String,
    pub timestamp: String,
    pub user_agent: String,
    pub event_type: String,
    pub data: serde_json::Value,
}
