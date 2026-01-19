#!/usr/bin/env python3
"""
Example script to analyze logs collected by the Network Logger extension.
This demonstrates how to process the logs for security analysis.
"""

import json
from collections import Counter, defaultdict
from urllib.parse import urlparse
import sys

def analyze_logs(log_file):
    """Analyze a JSON file containing logged requests."""
    
    with open(log_file, 'r') as f:
        data = json.load(f)
    
    # Flatten all logs from all batches
    all_logs = []
    for batch in data:
        all_logs.extend(batch['logs'])
    
    print(f"📊 Log Analysis Report")
    print(f"{'='*60}\n")
    
    # Basic statistics
    print(f"Total requests logged: {len(all_logs)}")
    print(f"Unique sessions: {len(set(batch['sessionId'] for batch in data))}")
    print()
    
    # Request types
    print("🔍 Request Types:")
    type_counts = Counter(log.get('type', 'unknown') for log in all_logs)
    for req_type, count in type_counts.most_common():
        print(f"  {req_type:20s}: {count:5d}")
    print()
    
    # JavaScript files
    js_logs = [log for log in all_logs if log.get('isJavaScript') or log.get('type') == 'script']
    print(f"📜 JavaScript Files: {len(js_logs)}")
    if js_logs:
        js_domains = Counter(urlparse(log['url']).netloc for log in js_logs)
        print("  Top domains serving JS:")
        for domain, count in js_domains.most_common(10):
            print(f"    {domain:40s}: {count:3d}")
    print()
    
    # Blocked requests
    blocked_logs = [log for log in all_logs if log.get('blocked')]
    print(f"⛔ Blocked Requests: {len(blocked_logs)}")
    if blocked_logs:
        for log in blocked_logs[:10]:
            print(f"  - {log['url']}")
    print()
    
    # HTTP status codes
    print("📈 HTTP Status Codes:")
    status_counts = Counter(log.get('statusCode') for log in all_logs if log.get('statusCode'))
    for status, count in sorted(status_counts.items()):
        status_category = "✓" if 200 <= status < 300 else "⚠" if 300 <= status < 400 else "✗"
        print(f"  {status_category} {status}: {count}")
    print()
    
    # Domain analysis
    print("🌐 Top Domains:")
    domain_counts = Counter(urlparse(log['url']).netloc for log in all_logs)
    for domain, count in domain_counts.most_common(15):
        print(f"  {domain:40s}: {count:3d}")
    print()
    
    # Third-party resources
    print("🔗 Third-Party Resources:")
    page_domains = set()
    third_party_resources = defaultdict(list)
    
    for log in all_logs:
        if log.get('type') == 'navigation':
            page_domains.add(urlparse(log['url']).netloc)
        elif log.get('initiator'):
            initiator_domain = urlparse(log.get('initiator', '')).netloc
            resource_domain = urlparse(log['url']).netloc
            if initiator_domain and resource_domain and initiator_domain != resource_domain:
                third_party_resources[initiator_domain].append(resource_domain)
    
    for page_domain in sorted(page_domains)[:5]:
        if page_domain in third_party_resources:
            third_parties = Counter(third_party_resources[page_domain])
            print(f"  {page_domain}:")
            for tp_domain, count in third_parties.most_common(5):
                print(f"    → {tp_domain} ({count} requests)")
    print()
    
    # Security concerns
    print("🔒 Security Analysis:")
    
    # Check for eval usage
    eval_logs = [log for log in all_logs if log.get('scriptUrl') == 'eval']
    if eval_logs:
        print(f"  ⚠ Found {len(eval_logs)} eval() executions")
        eval_pages = Counter(log['url'] for log in eval_logs)
        print("    Pages using eval():")
        for page, count in eval_pages.most_common(5):
            print(f"      - {page} ({count} times)")
    
    # Check for mixed content
    https_pages = set(log['url'] for log in all_logs if log.get('type') == 'navigation' and log['url'].startswith('https://'))
    http_resources = [log for log in all_logs if log['url'].startswith('http://')]
    mixed_content = [log for log in http_resources if any(log.get('initiator', '').startswith(page) for page in https_pages)]
    if mixed_content:
        print(f"  ⚠ Found {len(mixed_content)} potential mixed content issues")
    
    # Check for suspicious patterns
    suspicious_patterns = [
        ('.tk', 'Uncommon TLD .tk'),
        ('.xyz', 'Uncommon TLD .xyz'),
        ('base64', 'Base64 in URL'),
        ('eval', 'Eval in URL'),
    ]
    
    suspicious_logs = []
    for log in all_logs:
        url_lower = log['url'].lower()
        for pattern, reason in suspicious_patterns:
            if pattern in url_lower:
                suspicious_logs.append((log, reason))
    
    if suspicious_logs:
        print(f"  ⚠ Found {len(suspicious_logs)} requests matching suspicious patterns:")
        for log, reason in suspicious_logs[:10]:
            print(f"    - {reason}: {log['url'][:80]}")
    
    print()
    
    # Performance analysis
    print("⚡ Performance Insights:")
    failed_requests = [log for log in all_logs if log.get('statusCode', 0) >= 400]
    if failed_requests:
        print(f"  {len(failed_requests)} failed requests (4xx/5xx)")
        failed_domains = Counter(urlparse(log['url']).netloc for log in failed_requests)
        print("    Top failing domains:")
        for domain, count in failed_domains.most_common(5):
            print(f"      - {domain}: {count} failures")
    
    print()
    print("="*60)

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 analyze_logs.py <log_file.json>")
        print("\nTo get logs from the server:")
        print("  curl http://localhost:8080/api/logs > logs.json")
        print("  python3 analyze_logs.py logs.json")
        sys.exit(1)
    
    log_file = sys.argv[1]
    
    try:
        analyze_logs(log_file)
    except FileNotFoundError:
        print(f"Error: File '{log_file}' not found")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"Error: '{log_file}' is not valid JSON")
        sys.exit(1)
    except Exception as e:
        print(f"Error analyzing logs: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
