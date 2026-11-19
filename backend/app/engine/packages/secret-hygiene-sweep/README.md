# Secret Hygiene Sweep

Scans the automation package for committed credentials and risky secret patterns.

## What this automation does
Applies deterministic secret-detection rules to every text file in the package and records findings with file and line references. Optional external scanners are used when installed.

## Why it exists
Credentials committed into scripts are the fastest path from a repository leak to a production compromise. The sweep keeps that check inside the governed pipeline.

## When to use it
Before promoting any version, and after changing configuration or scripts.

## Expected output
A scan verdict with findings and remediation advice; high-confidence secrets stop the run.

## What can go wrong
Documentation examples can look like secrets. Placeholders are ignored, but review any finding rather than assuming it is a false positive.

## If the run fails
Open the failing finding, remove the credential, rotate it through the secrets provider, and publish a new automation version before retrying.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `secret_sweep` · Timeout: 180s · Production approval: required

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
