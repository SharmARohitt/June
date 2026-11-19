# Cache Warmup

Calls approved HTTP paths on the target fleet to warm caches before traffic.

## What this automation does
Requests each configured path on every target server so caches are populated before users arrive. Responses are summarised; bodies are not stored.

## Why it exists
Cold caches cause a slow first wave of traffic after a deployment or restart.

## When to use it
Immediately after a deployment, or before a known traffic peak.

## Expected output
Per-path and per-server response codes with timings.

## What can go wrong
A path may be protected by authentication, or simulated targets will not be contacted.

## If the run fails
Verify the paths are publicly readable health or landing endpoints and belong to the fleet.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `cache_warmup` · Timeout: 180s · Production approval: per policy

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
