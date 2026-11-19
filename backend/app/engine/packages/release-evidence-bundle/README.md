# Release Evidence Bundle

Packages SHA-256 hashes of the deployed package into a release evidence artifact.

## What this automation does
Reads the published automation package, hashes every file and writes a JSON evidence artifact with the candidate hash and timestamp.

## Why it exists
Auditors need a verifiable record of exactly which files were part of a release candidate.

## When to use it
As part of release preparation or whenever a signed evidence bundle is requested.

## Expected output
An evidence artifact stored in JUNE and downloadable from the execution page.

## What can go wrong
Missing package files will stop the run because an incomplete bundle is worthless.

## If the run fails
Verify the automation package exists and republish the automation version if needed.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `artifact_export` · Timeout: 120s · Production approval: per policy

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
