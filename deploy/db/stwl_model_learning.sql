-- Continuous-learning trace tables for the Save the Wildlife PAF model router.
-- Facts stay in STWL_GAME_EVENTS, STWL_REPLAY_CLIPS, and STWL_AGENT_MEMORIES.
-- These tables store behavior traces, model outputs, rubric results, and
-- promotion decisions for base-vs-fine-tuned evaluation.

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_model_traces (
      trace_id VARCHAR2(128) PRIMARY KEY,
      session_id VARCHAR2(128),
      room_id VARCHAR2(64),
      player_id VARCHAR2(128),
      run_id VARCHAR2(128),
      route_mode VARCHAR2(32),
      primary_provider VARCHAR2(64),
      candidate_provider VARCHAR2(64),
      selected_provider VARCHAR2(64),
      prompt_hash VARCHAR2(64),
      evidence_hash VARCHAR2(64),
      prompt_text CLOB,
      evidence_json CLOB CHECK (evidence_json IS JSON),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX stwl_model_traces_session_ix ON stwl_model_traces (session_id, player_id, created_at)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_model_outputs (
      output_id VARCHAR2(180) PRIMARY KEY,
      trace_id VARCHAR2(128) NOT NULL,
      provider VARCHAR2(64) NOT NULL,
      model_id VARCHAR2(256),
      is_primary NUMBER(1,0) DEFAULT 0 NOT NULL,
      is_candidate NUMBER(1,0) DEFAULT 0 NOT NULL,
      status VARCHAR2(32),
      latency_ms NUMBER,
      tokens NUMBER,
      finish_reason VARCHAR2(128),
      output_text CLOB,
      error_message VARCHAR2(1000),
      warnings_json CLOB CHECK (warnings_json IS JSON),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT stwl_model_outputs_trace_fk FOREIGN KEY (trace_id)
        REFERENCES stwl_model_traces(trace_id)
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX stwl_model_outputs_trace_ix ON stwl_model_outputs (trace_id, provider)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_model_evals (
      eval_id VARCHAR2(180) PRIMARY KEY,
      trace_id VARCHAR2(128) NOT NULL,
      rubric_version VARCHAR2(80),
      verdict VARCHAR2(40),
      scorer_notes VARCHAR2(1000),
      scores_json CLOB CHECK (scores_json IS JSON),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT stwl_model_evals_trace_fk FOREIGN KEY (trace_id)
        REFERENCES stwl_model_traces(trace_id)
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_training_examples (
      example_id VARCHAR2(180) PRIMARY KEY,
      trace_id VARCHAR2(128) NOT NULL,
      dataset_version VARCHAR2(80),
      split VARCHAR2(32),
      redaction_status VARCHAR2(40),
      accepted NUMBER(1,0) DEFAULT 0 NOT NULL,
      example_json CLOB CHECK (example_json IS JSON),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT stwl_training_examples_trace_fk FOREIGN KEY (trace_id)
        REFERENCES stwl_model_traces(trace_id)
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_model_promotions (
      promotion_id VARCHAR2(180) PRIMARY KEY,
      trace_id VARCHAR2(128),
      candidate_model_id VARCHAR2(256),
      adapter_uri VARCHAR2(1024),
      eval_run_id VARCHAR2(128),
      approval_state VARCHAR2(40),
      promotion_reason VARCHAR2(1000),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/
