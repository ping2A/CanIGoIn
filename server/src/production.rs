#[cfg(feature = "production")]
use crate::types::{Blocklist, ExtensionEvent, LogEntry};
#[cfg(feature = "production")]
use redis::Client as RedisClient;
#[cfg(feature = "production")]
use sqlx::{postgres::PgPoolOptions, PgPool};

#[cfg(feature = "production")]
pub struct ProductionState {
    db_pool: PgPool,
    redis_client: Option<RedisClient>,
}

#[cfg(feature = "production")]
impl ProductionState {
    pub async fn new(
        database_url: &str,
        redis_url: Option<&str>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let db_pool = PgPoolOptions::new()
            .max_connections(20)
            .connect(database_url)
            .await?;

        let redis_client = if let Some(url) = redis_url {
            Some(RedisClient::open(url)?)
        } else {
            None
        };

        Ok(ProductionState {
            db_pool,
            redis_client,
        })
    }

    pub async fn add_log(&self, entry: LogEntry) -> Result<(), sqlx::Error> {
        for log in &entry.logs {
            sqlx::query!(
                r#"
                INSERT INTO network_logs 
                (client_id, session_id, timestamp, user_agent, request_id, url, method, request_type, blocked, block_reason)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                "#,
                entry.client_id,
                entry.session_id,
                entry.timestamp,
                entry.user_agent,
                log.request_id,
                log.url,
                log.method,
                log.request_type,
                log.blocked,
                log.block_reason
            )
            .execute(&self.db_pool)
            .await?;
        }
        Ok(())
    }

    pub async fn get_blocklist(&self) -> Result<Blocklist, sqlx::Error> {
        let url_patterns: Vec<String> = sqlx::query_scalar!(
            "SELECT pattern FROM blocklist_patterns WHERE type = 'url' AND active = true"
        )
        .fetch_all(&self.db_pool)
        .await?;

        let youtube_channels: Vec<String> = sqlx::query_scalar!(
            "SELECT pattern FROM blocklist_patterns WHERE type = 'youtube' AND active = true"
        )
        .fetch_all(&self.db_pool)
        .await?;

        Ok(Blocklist {
            url_patterns,
            youtube_channels,
        })
    }

    pub async fn update_blocklist(&self, blocklist: Blocklist) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE blocklist_patterns SET active = false")
            .execute(&self.db_pool)
            .await?;

        for pattern in blocklist.url_patterns {
            sqlx::query!(
                "INSERT INTO blocklist_patterns (pattern, type) VALUES ($1, 'url') ON CONFLICT (pattern) DO UPDATE SET active = true",
                pattern
            )
            .execute(&self.db_pool)
            .await?;
        }

        for channel in blocklist.youtube_channels {
            sqlx::query!(
                "INSERT INTO blocklist_patterns (pattern, type) VALUES ($1, 'youtube') ON CONFLICT (pattern) DO UPDATE SET active = true",
                channel
            )
            .execute(&self.db_pool)
            .await?;
        }

        Ok(())
    }

    pub async fn add_extension_event(&self, event: ExtensionEvent) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO extension_events 
            (client_id, session_id, timestamp, user_agent, event_type, data)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            event.client_id,
            event.session_id,
            event.timestamp,
            event.user_agent,
            event.event_type,
            event.data
        )
        .execute(&self.db_pool)
        .await?;
        Ok(())
    }
}
