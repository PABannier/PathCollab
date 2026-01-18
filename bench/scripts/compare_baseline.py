#!/usr/bin/env python3
"""
compare_baseline.py - Compare benchmark results against baseline

This script compares current benchmark results to a saved baseline and:
- Reports percentage changes for key metrics
- Fails with exit code 1 if P99 regresses by more than threshold
- Generates a markdown summary suitable for PR comments

Usage:
    ./compare_baseline.py --current results.json --baseline baseline.json
    ./compare_baseline.py --current results.json --baseline baseline.json --threshold 10
    ./compare_baseline.py --save-baseline results.json --output baselines/tile_baseline.json

Examples:
    # Compare current run to baseline
    ./compare_baseline.py -c bench/load_tests/results/latest.json -b bench/baselines/tile_baseline.json

    # Save new baseline
    ./compare_baseline.py --save-baseline bench/load_tests/results/latest.json -o bench/baselines/tile_baseline.json
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Tuple

# ANSI colors for terminal output
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color


def load_json(path: Path) -> Dict[str, Any]:
    """Load and parse a JSON file."""
    with open(path) as f:
        return json.load(f)


def save_json(data: Dict[str, Any], path: Path) -> None:
    """Save data as JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"{Colors.GREEN}[OK]{Colors.NC} Saved baseline to {path}")


def extract_metrics(data: Dict[str, Any]) -> Dict[str, float]:
    """
    Extract key metrics from benchmark results.

    Supports both oha JSON output and custom summary format.
    """
    metrics = {}

    # oha format
    if 'summary' in data:
        summary = data['summary']
        metrics['requests_per_sec'] = summary.get('requestsPerSec', 0)
        metrics['success_rate'] = summary.get('successRate', 1.0) * 100

    if 'latencyPercentiles' in data:
        lat = data['latencyPercentiles']
        # oha returns latency in seconds, convert to ms
        metrics['p50_ms'] = lat.get('p50', 0) * 1000
        metrics['p90_ms'] = lat.get('p90', 0) * 1000
        metrics['p95_ms'] = lat.get('p95', 0) * 1000
        metrics['p99_ms'] = lat.get('p99', 0) * 1000
        if 'p999' in lat:
            metrics['p999_ms'] = lat.get('p999', 0) * 1000

    # Alternative: latencyDistribution format
    if 'latencyDistribution' in data and 'percentiles' in data['latencyDistribution']:
        lat = data['latencyDistribution']['percentiles']
        metrics['p50_ms'] = lat.get('p50', 0) * 1000
        metrics['p90_ms'] = lat.get('p90', 0) * 1000
        metrics['p95_ms'] = lat.get('p95', 0) * 1000
        metrics['p99_ms'] = lat.get('p99', 0) * 1000

    # Custom baseline format (already in correct units)
    if 'metrics' in data:
        metrics.update(data['metrics'])

    return metrics


def compare_metrics(
    current: Dict[str, float],
    baseline: Dict[str, float],
    threshold_pct: float = 10.0
) -> Tuple[bool, str, str]:
    """
    Compare current metrics to baseline.

    Returns:
        (passed, terminal_output, markdown_output)
    """
    passed = True
    terminal_lines = []
    md_lines = ["| Metric | Baseline | Current | Change | Status |",
                "|--------|----------|---------|--------|--------|"]

    # Metrics where lower is better (latencies)
    lower_is_better = {'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'p999_ms'}
    # Metrics where higher is better (throughput)
    higher_is_better = {'requests_per_sec', 'success_rate'}

    for metric in sorted(set(current.keys()) | set(baseline.keys())):
        curr_val = current.get(metric, 0)
        base_val = baseline.get(metric, 0)

        if base_val == 0:
            change_pct = 0 if curr_val == 0 else float('inf')
        else:
            change_pct = ((curr_val - base_val) / base_val) * 100

        # Determine if this is a regression
        is_regression = False
        if metric in lower_is_better and change_pct > threshold_pct:
            is_regression = True
        elif metric in higher_is_better and change_pct < -threshold_pct:
            is_regression = True

        # Format values
        if metric.endswith('_ms'):
            base_str = f"{base_val:.1f}ms"
            curr_str = f"{curr_val:.1f}ms"
        elif metric == 'success_rate':
            base_str = f"{base_val:.1f}%"
            curr_str = f"{curr_val:.1f}%"
        else:
            base_str = f"{base_val:.1f}"
            curr_str = f"{curr_val:.1f}"

        # Format change
        if change_pct == float('inf'):
            change_str = "N/A"
        else:
            sign = "+" if change_pct > 0 else ""
            change_str = f"{sign}{change_pct:.1f}%"

        # Status
        if is_regression:
            status = f"{Colors.RED}REGRESSED{Colors.NC}"
            status_md = "🔴 REGRESSED"
            if metric == 'p99_ms':
                passed = False  # Only fail on P99 regression
        elif abs(change_pct) < 5:
            status = f"{Colors.GREEN}OK{Colors.NC}"
            status_md = "✅ OK"
        elif metric in lower_is_better and change_pct < 0:
            status = f"{Colors.GREEN}IMPROVED{Colors.NC}"
            status_md = "🟢 IMPROVED"
        elif metric in higher_is_better and change_pct > 0:
            status = f"{Colors.GREEN}IMPROVED{Colors.NC}"
            status_md = "🟢 IMPROVED"
        else:
            status = f"{Colors.YELLOW}CHANGED{Colors.NC}"
            status_md = "🟡 CHANGED"

        terminal_lines.append(
            f"  {metric:20} {base_str:>12} → {curr_str:>12}  ({change_str:>8})  {status}"
        )
        md_lines.append(
            f"| {metric} | {base_str} | {curr_str} | {change_str} | {status_md} |"
        )

    terminal_output = "\n".join(terminal_lines)
    markdown_output = "\n".join(md_lines)

    return passed, terminal_output, markdown_output


def create_baseline(results: Dict[str, Any], description: str = "") -> Dict[str, Any]:
    """Create a baseline document from results."""
    metrics = extract_metrics(results)
    return {
        "created_at": datetime.utcnow().isoformat() + "Z",
        "description": description,
        "metrics": metrics,
        "raw_data": results
    }


def main():
    parser = argparse.ArgumentParser(
        description="Compare benchmark results against baseline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        "-c", "--current",
        type=Path,
        help="Current results JSON file"
    )
    parser.add_argument(
        "-b", "--baseline",
        type=Path,
        help="Baseline JSON file to compare against"
    )
    parser.add_argument(
        "-t", "--threshold",
        type=float,
        default=10.0,
        help="Regression threshold percentage (default: 10)"
    )
    parser.add_argument(
        "--save-baseline",
        type=Path,
        help="Save results as new baseline"
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        help="Output path for baseline (with --save-baseline)"
    )
    parser.add_argument(
        "-d", "--description",
        default="",
        help="Description for baseline (with --save-baseline)"
    )
    parser.add_argument(
        "--markdown",
        action="store_true",
        help="Output comparison as markdown table"
    )
    parser.add_argument(
        "--ci",
        action="store_true",
        help="CI mode: minimal output, exit code indicates pass/fail"
    )

    args = parser.parse_args()

    # Save baseline mode
    if args.save_baseline:
        if not args.output:
            print(f"{Colors.RED}[ERROR]{Colors.NC} --output required with --save-baseline")
            sys.exit(1)

        results = load_json(args.save_baseline)
        baseline = create_baseline(results, args.description)
        save_json(baseline, args.output)
        sys.exit(0)

    # Comparison mode
    if not args.current or not args.baseline:
        parser.print_help()
        sys.exit(1)

    if not args.current.exists():
        print(f"{Colors.RED}[ERROR]{Colors.NC} Current results not found: {args.current}")
        sys.exit(1)

    if not args.baseline.exists():
        print(f"{Colors.YELLOW}[WARN]{Colors.NC} Baseline not found: {args.baseline}")
        print("Run with --save-baseline to create initial baseline")
        sys.exit(0)

    # Load and compare
    current_data = load_json(args.current)
    baseline_data = load_json(args.baseline)

    current_metrics = extract_metrics(current_data)
    baseline_metrics = extract_metrics(baseline_data)

    passed, terminal_output, markdown_output = compare_metrics(
        current_metrics,
        baseline_metrics,
        args.threshold
    )

    # Output
    if args.markdown:
        print("## Benchmark Comparison\n")
        print(markdown_output)
        print()
        if passed:
            print("**Result: ✅ PASSED** - No significant regressions detected")
        else:
            print("**Result: ❌ FAILED** - P99 latency regression exceeds threshold")
    elif args.ci:
        if not passed:
            print(f"FAILED: P99 regression exceeds {args.threshold}% threshold")
    else:
        print()
        print("=" * 60)
        print(" Benchmark Comparison")
        print("=" * 60)
        print()
        print(f"  Baseline: {args.baseline}")
        print(f"  Current:  {args.current}")
        print(f"  Threshold: {args.threshold}%")
        print()
        print(terminal_output)
        print()
        if passed:
            print(f"{Colors.GREEN}PASSED{Colors.NC}: No significant regressions detected")
        else:
            print(f"{Colors.RED}FAILED{Colors.NC}: P99 latency regression exceeds {args.threshold}% threshold")
        print()

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
