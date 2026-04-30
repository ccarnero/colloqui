# Delta Specification: yoizenclaw-database

## ADDED Requirements

### REQ-YZC-DB-001: Agregar tenant_id a tablas de jobs

**Priority**: P0 (Critical)

The system MUST add a `tenant_id` column to all job-related tables in the YoizenClaw PostgreSQL schema to enable data isolation between tenants.

**Tables affected**:
- `jobs`: Add `tenant_id VARCHAR(255) NOT NULL` with index
- `job_executions`: Add `tenant_id VARCHAR(255) NOT NULL` with index  
- `runtime_config`: Add `tenant_id VARCHAR(255) NOT NULL` with index
- `embeddings`: Add `tenant_id VARCHAR(255) NOT NULL` with index

#### Scenario: Job creation with tenant isolation

- GIVEN a tenant "acme-corp" creates a new job
- WHEN the job is persisted to PostgreSQL
- THEN the job row MUST include `tenant_id = 'acme-corp'`
- AND queries for jobs MUST be filtered by tenant_id

#### Scenario: Prevent cross-tenant data access

- GIVEN jobs exist for tenants "acme-corp" and "other-tenant"
- WHEN the runtime queries jobs for tenant "acme-corp"
- THEN only jobs with `tenant_id = 'acme-corp'` MUST be returned
- AND jobs from "other-tenant" MUST NOT be accessible

### REQ-YZC-DB-002: Migración de datos existentes

**Priority**: P1 (High)

The system MUST provide Alembic migrations to add tenant_id to existing data with a safe default value or migration script.

#### Scenario: Migration for existing jobs

- GIVEN a database with existing jobs without tenant_id
- WHEN the Alembic migration runs
- THEN the migration MUST either:
  - Assign a default tenant_id based on configuration, OR
  - Provide a data migration script to map existing jobs to tenants

#### Scenario: Rollback migration

- GIVEN the migration has been applied
- WHEN `alembic downgrade` is executed
- THEN the tenant_id columns MUST be removed
- AND the database MUST return to its previous state

## MODIFIED Requirements

### REQ-YZC-DB-003: MemoryBackend queries with tenant filter

**Priority**: P0 (Critical)

The system SHALL modify all `MemoryBackend` implementations to include `tenant_id` in WHERE clauses for all database operations.

**Modified methods**:
- `save_job()`: Include tenant_id in INSERT/UPDATE
- `get_job()`: Filter by tenant_id + job_id
- `get_all_jobs()`: Filter by tenant_id only
- `delete_job()`: Filter by tenant_id + job_id
- `save_job_execution()`: Include tenant_id
- `get_job_executions()`: Filter by tenant_id + job_id
- `list_jobs()`: Filter by tenant_id

#### Scenario: Query job by ID with tenant validation

- GIVEN a job with ID "job-123" belongs to tenant "acme-corp"
- WHEN tenant "acme-corp" queries job "job-123"
- THEN the job MUST be returned

#### Scenario: Cross-tenant job access denied

- GIVEN a job with ID "job-123" belongs to tenant "acme-corp"
- WHEN tenant "other-tenant" attempts to query job "job-123"
- THEN a `JobNotFoundError` MUST be raised

## Non-Functional Requirements

### NFR-DB-001: Database query performance

**Category**: Performance
**Priority**: P1 (High)

The system MUST maintain query performance after adding tenant_id filters.

- **Metric**: Query execution time
- **Target**: < 50ms for queries with tenant_id filter on tables with 100K rows
- **Measurement**: Query EXPLAIN ANALYZE on representative dataset

### NFR-DB-002: Index coverage for tenant_id

**Category**: Performance  
**Priority**: P0 (Critical)

The system SHALL create composite indexes on `(tenant_id, id)` for efficient lookups.

- **Metric**: Index usage
- **Target**: All tenant-filtered queries MUST use index scans
- **Measurement**: Database query plan analysis
