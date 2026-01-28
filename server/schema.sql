-- ============================================================================
-- Network Logger Server - PostgreSQL Schema
-- For Production Mode Only
-- ============================================================================

-- Network Logs Table
CREATE TABLE IF NOT EXISTS network_logs (
    id BIGSERIAL PRIMARY KEY,
    client_id VARCHAR(200),
    session_id VARCHAR(100) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    user_agent TEXT,
    request_id VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    method VARCHAR(20) NOT NULL,
    request_type VARCHAR(50),
    blocked BOOLEAN DEFAULT false,
    block_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session_id (session_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_blocked (blocked),
    INDEX idx_url_hash (MD5(url))
);

-- Blocklist Patterns Table
CREATE TABLE IF NOT EXISTS blocklist_patterns (
    id SERIAL PRIMARY KEY,
    pattern TEXT NOT NULL UNIQUE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('url', 'youtube')),
    description TEXT,
    added_by VARCHAR(100),
    added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT true,
    
    INDEX idx_type (type),
    INDEX idx_active (active),
    INDEX idx_type_active (type, active)
);

-- Extension Events Table
CREATE TABLE IF NOT EXISTS extension_events (
    id BIGSERIAL PRIMARY KEY,
    client_id VARCHAR(200),
    session_id VARCHAR(100) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    user_agent TEXT,
    event_type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session_id (session_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_event_type (event_type),
    INDEX idx_data_gin (data) USING GIN
);

-- Insert default blocklist patterns
INSERT INTO blocklist_patterns (pattern, type, description) VALUES
    ('.*tracker\\..*', 'url', 'Block tracking domains'),
    ('.*analytics\\..*', 'url', 'Block analytics domains'),
    ('.*doubleclick\\..*', 'url', 'Block ad networks'),
    ('.*ads\\..*', 'url', 'Block ad domains')
ON CONFLICT (pattern) DO NOTHING;
