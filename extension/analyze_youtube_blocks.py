#!/usr/bin/env python3
"""
Analyze YouTube channel blocking from extension logs.
Shows statistics on blocked channels and access attempts.
"""

import json
from collections import Counter, defaultdict
from datetime import datetime
import sys

def analyze_youtube_blocks(log_file):
    """Analyze YouTube blocking data from logs."""
    
    with open(log_file, 'r') as f:
        data = json.load(f)
    
    # Flatten all logs
    all_logs = []
    for batch in data:
        all_logs.extend(batch['logs'])
    
    # Filter for YouTube-related logs
    youtube_logs = [log for log in all_logs if 'youtube.com' in log.get('url', '')]
    youtube_blocks = [log for log in youtube_logs if log.get('blocked') and log.get('blockReason') == 'youtube_channel']
    
    print("🎬 YouTube Channel Blocking Analysis")
    print("=" * 70)
    print()
    
    # Basic stats
    print(f"📊 Overall Statistics:")
    print(f"  Total YouTube requests: {len(youtube_logs)}")
    print(f"  Blocked channel accesses: {len(youtube_blocks)}")
    if youtube_logs:
        block_rate = (len(youtube_blocks) / len(youtube_logs)) * 100
        print(f"  Block rate: {block_rate:.1f}%")
    print()
    
    if not youtube_blocks:
        print("No YouTube channel blocks found in logs.")
        return
    
    # Extract channel information
    blocked_channels = defaultdict(list)
    for log in youtube_blocks:
        channel_info = log.get('youtubeChannelInfo', {})
        channel_id = channel_info.get('id', 'Unknown')
        channel_type = channel_info.get('type', 'unknown')
        
        blocked_channels[channel_id].append({
            'timestamp': log.get('timestamp'),
            'url': log.get('url'),
            'type': channel_type
        })
    
    # Channel blocking summary
    print("🚫 Blocked Channels Summary:")
    print(f"  Unique channels blocked: {len(blocked_channels)}")
    print()
    
    print("📋 Top Blocked Channels:")
    sorted_channels = sorted(
        blocked_channels.items(),
        key=lambda x: len(x[1]),
        reverse=True
    )
    
    for i, (channel_id, attempts) in enumerate(sorted_channels[:10], 1):
        channel_type = attempts[0]['type']
        print(f"  {i}. {channel_id} ({channel_type})")
        print(f"     Access attempts: {len(attempts)}")
        
        # Show first and last attempt
        timestamps = [datetime.fromisoformat(a['timestamp'].replace('Z', '+00:00')) for a in attempts]
        first_attempt = min(timestamps).strftime('%Y-%m-%d %H:%M:%S')
        last_attempt = max(timestamps).strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"     First attempt: {first_attempt}")
        if len(attempts) > 1:
            print(f"     Last attempt:  {last_attempt}")
        print()
    
    # Timeline analysis
    print("📅 Timeline Analysis:")
    
    # Group by hour
    hour_counts = Counter()
    for log in youtube_blocks:
        timestamp = datetime.fromisoformat(log['timestamp'].replace('Z', '+00:00'))
        hour_key = timestamp.strftime('%Y-%m-%d %H:00')
        hour_counts[hour_key] += 1
    
    if hour_counts:
        print("  Blocks per hour (top 10):")
        for hour, count in hour_counts.most_common(10):
            print(f"    {hour}: {count} blocks")
    print()
    
    # Access patterns
    print("🔍 Access Patterns:")
    
    # Count by channel type
    type_counts = Counter()
    for log in youtube_blocks:
        channel_info = log.get('youtubeChannelInfo', {})
        channel_type = channel_info.get('type', 'unknown')
        type_counts[channel_type] += 1
    
    print("  Blocks by channel identifier type:")
    for channel_type, count in type_counts.items():
        print(f"    {channel_type}: {count}")
    print()
    
    # Repeated access attempts
    print("🔁 Repeated Access Attempts:")
    repeat_offenders = [(ch, len(attempts)) for ch, attempts in sorted_channels if len(attempts) >= 3]
    
    if repeat_offenders:
        print(f"  Channels with 3+ access attempts: {len(repeat_offenders)}")
        for channel_id, count in repeat_offenders[:5]:
            print(f"    {channel_id}: {count} attempts")
    else:
        print("  No channels with repeated access attempts (3+)")
    print()
    
    # Session analysis
    print("📊 Session Analysis:")
    sessions = defaultdict(int)
    for log in youtube_blocks:
        session_id = log.get('sessionId', 'unknown')
        sessions[session_id] += 1
    
    print(f"  Sessions with YouTube blocks: {len(sessions)}")
    if sessions:
        avg_blocks = sum(sessions.values()) / len(sessions)
        print(f"  Average blocks per session: {avg_blocks:.1f}")
        max_blocks = max(sessions.values())
        print(f"  Max blocks in a session: {max_blocks}")
    print()
    
    # Recent blocks
    print("🕐 Recent Blocks (Last 10):")
    sorted_blocks = sorted(
        youtube_blocks,
        key=lambda x: x.get('timestamp', ''),
        reverse=True
    )
    
    for i, log in enumerate(sorted_blocks[:10], 1):
        timestamp = log.get('timestamp', 'Unknown')
        channel_info = log.get('youtubeChannelInfo', {})
        channel_id = channel_info.get('id', 'Unknown')
        url = log.get('url', '')[:60] + '...' if len(log.get('url', '')) > 60 else log.get('url', '')
        
        print(f"  {i}. [{timestamp}]")
        print(f"     Channel: {channel_id}")
        print(f"     URL: {url}")
        print()
    
    # Export for further analysis
    print("💡 Tip: You can export this data for further analysis:")
    print("  - Import into spreadsheet software")
    print("  - Visualize with Python (matplotlib, seaborn)")
    print("  - Feed into ML models for pattern detection")
    print()
    
    print("=" * 70)

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 analyze_youtube_blocks.py <log_file.json>")
        print("\nTo get logs from the server:")
        print("  curl http://localhost:8080/api/logs > logs.json")
        print("  python3 analyze_youtube_blocks.py logs.json")
        sys.exit(1)
    
    log_file = sys.argv[1]
    
    try:
        analyze_youtube_blocks(log_file)
    except FileNotFoundError:
        print(f"Error: File '{log_file}' not found")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"Error: '{log_file}' is not valid JSON")
        sys.exit(1)
    except Exception as e:
        print(f"Error analyzing logs: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
