use crate::types::{Blocklist, ExtensionEvent, LogEntry};
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
                youtube_channels: vec!["@spam".to_string()],
            }),
            extension_events: Mutex::new(Vec::new()),
        }
    }

    pub fn add_log(&self, entry: LogEntry) {
        let mut logs = self.logs.lock().unwrap();
        logs.push(entry);
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
        if events.len() > 500 {
            let len = events.len();
            events.drain(0..len - 500);
        }
    }

    pub fn get_extension_events(&self) -> Vec<ExtensionEvent> {
        self.extension_events.lock().unwrap().clone()
    }
}
