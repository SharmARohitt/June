# Server Health Check

Checks whether the servers in an approved target group are reachable and responding.

## What this automation does
JUNE sends a real HTTP request to every server in the target group and records the status code, latency and reachability for each one. Simulated targets are listed but never probed.

## Why it exists
Before a release or after an infrastructure change, the team needs one dependable answer to 'are these servers actually answering?' without opening SSH sessions.

## When to use it
Use it before deploying, after restarting a service, or when investigating a suspected outage. It is read-only and safe to run repeatedly.

## Expected output
A per-server table with reachable/unreachable status and latency, plus an overall reachable count.

## What can go wrong
A firewall may block the probe, the health path may return a server error, or the target may be marked as simulated and therefore intentionally not contacted.

## If the run fails
Confirm the target group and HTTP path, check the per-server log lines, and verify network reachability from the execution plane. Do not retry blindly if every server reports unreachable.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `health_check` · Timeout: 120s · Production approval: per policy

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
