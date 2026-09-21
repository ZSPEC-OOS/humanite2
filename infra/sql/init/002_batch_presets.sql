-- Presets: named collections of humanization settings per user
CREATE TABLE presets (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    intensity    INTEGER     NOT NULL CHECK (intensity BETWEEN 1 AND 10),
    tone         VARCHAR(20) NOT NULL,
    domain       VARCHAR(20) NOT NULL,
    preserve_citations BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

-- Batch jobs: parent record for a multi-item submission
CREATE TABLE batch_jobs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','partial','failed')),
    total_items     INTEGER     NOT NULL,
    completed_items INTEGER     NOT NULL DEFAULT 0,
    failed_items    INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- Batch items: one row per text item within a batch
CREATE TABLE batch_items (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_job_id  UUID        NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    item_id       VARCHAR(64) NOT NULL,
    operation     VARCHAR(10) NOT NULL CHECK (operation IN ('humanize','scan')),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed','skipped')),
    input_hash    TEXT        NOT NULL,
    job_id        UUID        REFERENCES jobs(id),
    error_code    VARCHAR(80),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_job_id, item_id)
);

CREATE INDEX idx_presets_user_id       ON presets(user_id);
CREATE INDEX idx_batch_jobs_user_id    ON batch_jobs(user_id);
CREATE INDEX idx_batch_jobs_status     ON batch_jobs(status);
CREATE INDEX idx_batch_items_batch_id  ON batch_items(batch_job_id);
CREATE INDEX idx_batch_items_status    ON batch_items(batch_job_id, status);
