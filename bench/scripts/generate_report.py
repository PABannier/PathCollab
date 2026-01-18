#!/usr/bin/env python3
"""
generate_report.py - Generate markdown benchmark report

This script aggregates results from all benchmark phases and produces
a comprehensive markdown report suitable for:
- PR comments
- Documentation
- Historical tracking

Usage:
    ./generate_report.py --input-dir bench/load_tests/results/run_YYYYMMDD_HHMMSS --output REPORT.md
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List


def load_json_safe(path: Path) -> Optional[Dict[str, Any]]:
    """Load JSON file, returning None on error."""
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def load_text_safe(path: Path) -> Optional[str]:
    """Load text file, returning None on error."""
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return None


def parse_criterion_output(text: str) -> List[Dict[str, Any]]:
    """Parse Criterion benchmark output for key metrics."""
    results = []

    # Pattern: "benchmark_name  time:   [123.45 µs 125.67 µs 127.89 µs]"
    pattern = r'(\S+)\s+time:\s+\[(\d+\.?\d*)\s*(\w+)\s+(\d+\.?\d*)\s*(\w+)\s+(\d+\.?\d*)\s*(\w+)\]'

    for match in re.finditer(pattern, text):
        name = match.group(1)
        low = float(match.group(2))
        low_unit = match.group(3)
        mid = float(match.group(4))
        mid_unit = match.group(5)
        high = float(match.group(6))
        high_unit = match.group(7)

        # Normalize to microseconds
        def to_us(val, unit):
            if unit == 'ns':
                return val / 1000
            elif unit == 'µs' or unit == 'us':
                return val
            elif unit == 'ms':
                return val * 1000
            elif unit == 's':
                return val * 1_000_000
            return val

        results.append({
            'name': name,
            'low_us': to_us(low, low_unit),
            'mid_us': to_us(mid, mid_unit),
            'high_us': to_us(high, high_unit),
        })

    return results


def parse_websocket_output(text: str) -> Dict[str, Any]:
    """Parse WebSocket load test output."""
    result = {
        'passed': 'PASS' in text,
        'messages_sent': 0,
        'messages_received': 0,
        'cursor_p99': None,
        'viewport_p99': None,
    }

    # Extract metrics
    if match := re.search(r'Messages sent:\s*(\d+)', text):
        result['messages_sent'] = int(match.group(1))
    if match := re.search(r'Messages received:\s*(\d+)', text):
        result['messages_received'] = int(match.group(1))
    if match := re.search(r'Cursor.*P99:\s*([\d.]+\w+)', text):
        result['cursor_p99'] = match.group(1)
    if match := re.search(r'Viewport.*P99:\s*([\d.]+\w+)', text):
        result['viewport_p99'] = match.group(1)

    return result


def format_duration(us: float) -> str:
    """Format duration in appropriate units."""
    if us < 1:
        return f"{us * 1000:.2f}ns"
    elif us < 1000:
        return f"{us:.2f}µs"
    elif us < 1_000_000:
        return f"{us / 1000:.2f}ms"
    else:
        return f"{us / 1_000_000:.2f}s"


def generate_report(input_dir: Path) -> str:
    """Generate markdown report from benchmark results."""

    lines = []
    lines.append("# PathCollab Benchmark Report")
    lines.append("")
    lines.append(f"**Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
    lines.append(f"**Run directory:** `{input_dir.name}`")
    lines.append("")

    # Table of Contents
    lines.append("## Table of Contents")
    lines.append("- [Summary](#summary)")
    lines.append("- [HTTP Tile Performance](#http-tile-performance)")
    lines.append("- [WebSocket Performance](#websocket-performance)")
    lines.append("- [Micro-benchmarks](#micro-benchmarks)")
    lines.append("- [Server Metrics](#server-metrics)")
    lines.append("")

    # Summary
    lines.append("## Summary")
    lines.append("")

    tile_data = load_json_safe(input_dir / "tile_stress.json")
    ws_text = load_text_safe(input_dir / "websocket_load.txt")
    ws_data = parse_websocket_output(ws_text) if ws_text else {}

    summary_items = []

    if tile_data:
        rps = tile_data.get('summary', {}).get('requestsPerSec', 0)
        p99 = tile_data.get('latencyPercentiles', {}).get('p99', 0) * 1000
        success = tile_data.get('summary', {}).get('successRate', 1) * 100
        summary_items.append(f"- **Tile serving:** {rps:.0f} req/s, P99: {p99:.1f}ms, Success: {success:.1f}%")
        tile_status = "✅ PASS" if p99 < 100 else "❌ FAIL (P99 > 100ms)"
    else:
        tile_status = "⚠️ No data"
        summary_items.append("- **Tile serving:** No data collected")

    if ws_data.get('passed'):
        summary_items.append(f"- **WebSocket:** P99 cursor: {ws_data.get('cursor_p99', 'N/A')}, P99 viewport: {ws_data.get('viewport_p99', 'N/A')}")
        ws_status = "✅ PASS"
    elif ws_text:
        ws_status = "❌ FAIL"
        summary_items.append("- **WebSocket:** Test failed")
    else:
        ws_status = "⚠️ No data"
        summary_items.append("- **WebSocket:** No data collected")

    lines.append("| Component | Status |")
    lines.append("|-----------|--------|")
    lines.append(f"| HTTP Tile Serving | {tile_status} |")
    lines.append(f"| WebSocket Broadcasting | {ws_status} |")
    lines.append("")
    lines.extend(summary_items)
    lines.append("")

    # HTTP Tile Performance
    lines.append("## HTTP Tile Performance")
    lines.append("")

    if tile_data:
        summary = tile_data.get('summary', {})
        latency = tile_data.get('latencyPercentiles', {})

        lines.append("### Throughput")
        lines.append("")
        lines.append(f"- **Requests/sec:** {summary.get('requestsPerSec', 0):.1f}")
        lines.append(f"- **Total requests:** {summary.get('total', 0)}")
        lines.append(f"- **Success rate:** {summary.get('successRate', 1) * 100:.1f}%")
        lines.append("")

        lines.append("### Latency Distribution")
        lines.append("")
        lines.append("| Percentile | Latency |")
        lines.append("|------------|---------|")
        for p in ['p50', 'p75', 'p90', 'p95', 'p99', 'p999']:
            val = latency.get(p, 0) * 1000  # to ms
            lines.append(f"| {p.upper()} | {val:.2f}ms |")
        lines.append("")

        # Status codes
        status_dist = tile_data.get('statusCodeDistribution', {})
        if status_dist:
            lines.append("### Status Codes")
            lines.append("")
            lines.append("| Code | Count |")
            lines.append("|------|-------|")
            for code, count in sorted(status_dist.items()):
                lines.append(f"| {code} | {count} |")
            lines.append("")
    else:
        lines.append("*No HTTP tile performance data available.*")
        lines.append("")

    # WebSocket Performance
    lines.append("## WebSocket Performance")
    lines.append("")

    if ws_text:
        lines.append("### Results")
        lines.append("")
        lines.append(f"- **Status:** {'PASS' if ws_data.get('passed') else 'FAIL'}")
        lines.append(f"- **Messages sent:** {ws_data.get('messages_sent', 'N/A')}")
        lines.append(f"- **Messages received:** {ws_data.get('messages_received', 'N/A')}")
        lines.append(f"- **Cursor P99:** {ws_data.get('cursor_p99', 'N/A')}")
        lines.append(f"- **Viewport P99:** {ws_data.get('viewport_p99', 'N/A')}")
        lines.append("")

        # Include raw output excerpt
        lines.append("<details>")
        lines.append("<summary>Raw Output</summary>")
        lines.append("")
        lines.append("```")
        # Include just the results section
        if "=== Load Test Results ===" in ws_text:
            start = ws_text.find("=== Load Test Results ===")
            lines.append(ws_text[start:start + 1500])
        else:
            lines.append(ws_text[:1500])
        lines.append("```")
        lines.append("</details>")
        lines.append("")
    else:
        lines.append("*No WebSocket performance data available.*")
        lines.append("")

    # Micro-benchmarks
    lines.append("## Micro-benchmarks")
    lines.append("")

    micro_text = load_text_safe(input_dir / "micro_benchmarks.txt")
    if micro_text:
        benchmarks = parse_criterion_output(micro_text)

        if benchmarks:
            # Group by benchmark file
            groups = {}
            for b in benchmarks:
                # Extract group from name like "jpeg_encoding/256x256/85"
                parts = b['name'].split('/')
                group = parts[0] if parts else 'other'
                if group not in groups:
                    groups[group] = []
                groups[group].append(b)

            for group_name, items in sorted(groups.items()):
                lines.append(f"### {group_name.replace('_', ' ').title()}")
                lines.append("")
                lines.append("| Benchmark | Time (median) | Range |")
                lines.append("|-----------|---------------|-------|")
                for b in items:
                    name = '/'.join(b['name'].split('/')[1:]) or b['name']
                    lines.append(f"| {name} | {format_duration(b['mid_us'])} | {format_duration(b['low_us'])} - {format_duration(b['high_us'])} |")
                lines.append("")
        else:
            lines.append("*Could not parse benchmark results.*")
            lines.append("")
    else:
        lines.append("*No micro-benchmark data available.*")
        lines.append("")

    # Server Metrics
    lines.append("## Server Metrics")
    lines.append("")

    metrics_data = load_json_safe(input_dir / "server_metrics.json")
    if metrics_data:
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        for key, value in sorted(metrics_data.items()):
            lines.append(f"| {key} | {value} |")
        lines.append("")
    else:
        lines.append("*No server metrics available.*")
        lines.append("")

    # Footer
    lines.append("---")
    lines.append("")
    lines.append("*Report generated by `bench/scripts/generate_report.py`*")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate markdown benchmark report"
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Directory containing benchmark results"
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output markdown file (default: stdout)"
    )

    args = parser.parse_args()

    if not args.input_dir.exists():
        print(f"Error: Input directory not found: {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    report = generate_report(args.input_dir)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, 'w') as f:
            f.write(report)
        print(f"Report saved to: {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
