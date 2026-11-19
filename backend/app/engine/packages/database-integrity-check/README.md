# Database Integrity Check

Runs read-only integrity and row-count checks against the JUNE control-plane database.

## What this automation does
Executes database-native integrity checks and counts rows in the core tables. Every statement is read-only; the runner cannot modify application data.

## Why it exists
Before enabling production flows, the team wants evidence that the control-plane database is structurally sound and contains the expected records.

## When to use it
Run after migrations, after restoring a backup, or as a periodic sanity check.

## Expected output
An integrity verdict plus row counts for the core domain tables.

## What can go wrong
A locked database or a failed integrity check will stop the run with a clear error.

## If the run fails
Review the failing check, confirm database availability, and involve the platform team before attempting any repair.

## Ownership
Priya Nair — Platform Engineering

## Execution
Runner: `db_integrity` · Timeout: 180s · Production approval: per policy

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
