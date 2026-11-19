# Log Retention Audit

Audits the sandbox log directory for oversized or expired log files.

## What this automation does
Walks the approved sandbox log directory and reports files larger than the configured limit or older than the retention window. It never deletes anything.

## Why it exists
Log growth silently fills disks and causes outages that are hard to trace afterwards.

## When to use it
Run weekly, or whenever disk pressure is suspected on an application host.

## Expected output
Counts of oversized and expired files with their paths and sizes.

## What can go wrong
The sandbox may not contain log files yet, so the report will be empty.

## If the run fails
Check that the sandbox log directory exists. An empty report is a valid result, not a failure.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `log_audit` · Timeout: 180s · Production approval: per policy

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
