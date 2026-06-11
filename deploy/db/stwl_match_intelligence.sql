-- Additive match-intelligence layer for Save the Wildlife.
-- The core gameplay ledger remains STWL_GAME_EVENTS. These objects expose the
-- same truth as JSON documents, graph-ready relationships, replay clip
-- manifests, and vector-ready memories for Oracle Private Agent Factory.

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE stwl_replay_clips (
      clip_id VARCHAR2(128) PRIMARY KEY,
      session_id VARCHAR2(128) NOT NULL,
      room_id VARCHAR2(64),
      player_id VARCHAR2(128),
      event_type VARCHAR2(64) NOT NULL,
      event_at TIMESTAMP WITH TIME ZONE,
      clip_uri VARCHAR2(1024),
      thumbnail_uri VARCHAR2(1024),
      timecode_start_ms NUMBER,
      timecode_end_ms NUMBER,
      frame_count NUMBER,
      moderation_status VARCHAR2(32) DEFAULT 'approved' NOT NULL,
      tags_json CLOB CHECK (tags_json IS JSON),
      metadata_json CLOB CHECK (metadata_json IS JSON),
      replay_json CLOB CHECK (replay_json IS JSON),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX stwl_replay_clips_session_ix ON stwl_replay_clips (session_id, event_at)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

DECLARE
  v_created NUMBER := 0;
BEGIN
  BEGIN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE stwl_agent_memories (
        memory_id VARCHAR2(160) PRIMARY KEY,
        session_id VARCHAR2(128) NOT NULL,
        room_id VARCHAR2(64),
        player_id VARCHAR2(128),
        memory_type VARCHAR2(40) DEFAULT 'session' NOT NULL,
        score NUMBER,
        content CLOB NOT NULL,
        embedding_text CLOB,
        embedding VECTOR(1024, FLOAT32),
        embedding_json CLOB CHECK (embedding_json IS JSON),
        metadata_json CLOB CHECK (metadata_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )
    ]';
    v_created := 1;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE = -955 THEN
        v_created := 1;
      ELSE
        v_created := 0;
      END IF;
  END;

  IF v_created = 0 THEN
    BEGIN
      EXECUTE IMMEDIATE q'[
        CREATE TABLE stwl_agent_memories (
          memory_id VARCHAR2(160) PRIMARY KEY,
          session_id VARCHAR2(128) NOT NULL,
          room_id VARCHAR2(64),
          player_id VARCHAR2(128),
          memory_type VARCHAR2(40) DEFAULT 'session' NOT NULL,
          score NUMBER,
          content CLOB NOT NULL,
          embedding_text CLOB,
          embedding_json CLOB CHECK (embedding_json IS JSON),
          metadata_json CLOB CHECK (metadata_json IS JSON),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
        )
      ]';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;
  END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX stwl_agent_memories_player_ix ON stwl_agent_memories (player_id, created_at)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

CREATE OR REPLACE VIEW stwl_event_documents AS
SELECT
  e.id AS event_id,
  e.session_id,
  e.room_id,
  e.player_id,
  e.event_type,
  e.occurred_at,
  JSON_OBJECT(
    'event_id' VALUE e.id,
    'session_id' VALUE e.session_id,
    'room_id' VALUE e.room_id,
    'player' VALUE JSON_OBJECT(
      'id' VALUE e.player_id,
      'name' VALUE e.player_name
    ),
    'event_type' VALUE e.event_type,
    'occurred_at' VALUE e.occurred_at,
    'score' VALUE e.score,
    'position' VALUE JSON_OBJECT('x' VALUE e.x, 'y' VALUE e.y, 'z' VALUE e.z),
    'related_player_id' VALUE e.related_player_id,
    'related_item_id' VALUE e.related_item_id,
    'metadata' VALUE COALESCE(e.metadata_json, TO_CLOB('{}')) FORMAT JSON
    RETURNING CLOB
  ) AS event_doc
FROM stwl_game_events e;

CREATE OR REPLACE VIEW stwl_graph_vertices AS
SELECT
  'SESSION:' || session_id AS vertex_id,
  'session' AS vertex_type,
  session_id,
  CAST(NULL AS VARCHAR2(128)) AS player_id,
  CAST(NULL AS VARCHAR2(128)) AS item_id,
  JSON_OBJECT('session_id' VALUE session_id) AS properties_json
FROM stwl_game_events
GROUP BY session_id
UNION ALL
SELECT
  'PLAYER:' || player_id AS vertex_id,
  'player' AS vertex_type,
  CAST(NULL AS VARCHAR2(128)) AS session_id,
  player_id,
  CAST(NULL AS VARCHAR2(128)) AS item_id,
  JSON_OBJECT('player_id' VALUE player_id, 'player_name' VALUE MAX(player_name), 'session_count' VALUE COUNT(DISTINCT session_id)) AS properties_json
FROM stwl_game_events
GROUP BY player_id
UNION ALL
SELECT
  'ITEM:' || related_item_id AS vertex_id,
  'item' AS vertex_type,
  CAST(NULL AS VARCHAR2(128)) AS session_id,
  CAST(NULL AS VARCHAR2(128)) AS player_id,
  related_item_id AS item_id,
  JSON_OBJECT('item_id' VALUE related_item_id, 'session_count' VALUE COUNT(DISTINCT session_id)) AS properties_json
FROM stwl_game_events
WHERE related_item_id IS NOT NULL
GROUP BY related_item_id;

CREATE OR REPLACE VIEW stwl_graph_edges AS
SELECT
  'SESSION_EVENT:' || id AS edge_id,
  'SESSION:' || session_id AS source_id,
  'PLAYER:' || player_id AS target_id,
  'session_has_player_event' AS edge_type,
  session_id,
  player_id,
  event_type,
  occurred_at,
  JSON_OBJECT('event_id' VALUE id, 'event_type' VALUE event_type) AS properties_json
FROM stwl_game_events
UNION ALL
SELECT
  'PLAYER_ITEM:' || id AS edge_id,
  'PLAYER:' || player_id AS source_id,
  'ITEM:' || related_item_id AS target_id,
  CASE
    WHEN event_type = 'powerup_collected' THEN 'collected_powerup'
    WHEN event_type = 'trash_collected' THEN 'collected_trash'
    WHEN event_type = 'marine_hit' THEN 'hit_marine_life'
    ELSE 'related_to_item'
  END AS edge_type,
  session_id,
  player_id,
  event_type,
  occurred_at,
  JSON_OBJECT('event_id' VALUE id, 'metadata' VALUE COALESCE(metadata_json, TO_CLOB('{}')) FORMAT JSON) AS properties_json
FROM stwl_game_events
WHERE related_item_id IS NOT NULL
UNION ALL
SELECT
  'PLAYER_PLAYER:' || id AS edge_id,
  'PLAYER:' || player_id AS source_id,
  'PLAYER:' || related_player_id AS target_id,
  CASE
    WHEN event_type = 'trail_crossed' THEN 'crossed_trail_from'
    WHEN event_type = 'player_frozen' THEN 'frozen_by'
    ELSE 'related_to_player'
  END AS edge_type,
  session_id,
  player_id,
  event_type,
  occurred_at,
  JSON_OBJECT('event_id' VALUE id, 'metadata' VALUE COALESCE(metadata_json, TO_CLOB('{}')) FORMAT JSON) AS properties_json
FROM stwl_game_events
WHERE related_player_id IS NOT NULL;

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE PROPERTY GRAPH stwl_gameplay_graph
      VERTEX TABLES (
        stwl_graph_vertices
          KEY (vertex_id)
          LABEL vertex
          PROPERTIES (vertex_type, session_id, player_id, item_id, properties_json)
      )
      EDGE TABLES (
        stwl_graph_edges
          KEY (edge_id)
          SOURCE KEY (source_id) REFERENCES stwl_graph_vertices(vertex_id)
          DESTINATION KEY (target_id) REFERENCES stwl_graph_vertices(vertex_id)
          LABEL relationship
          PROPERTIES (edge_type, session_id, player_id, event_type, occurred_at, properties_json)
      )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
/

COMMENT ON TABLE stwl_replay_clips IS
  'Replay clip manifest linking gameplay telemetry to JSON replay payloads or production media/object-storage references.';
COMMENT ON TABLE stwl_agent_memories IS
  'Vector-ready gameplay memory cards used for similar-moment retrieval and player/session memory.';
COMMENT ON VIEW stwl_event_documents IS
  'Document-shaped gameplay events for JSON-oriented agent context.';
COMMENT ON VIEW stwl_graph_vertices IS
  'Graph-ready vertices for sessions, players, and items.';
COMMENT ON VIEW stwl_graph_edges IS
  'Graph-ready relationships for player/session/item events, trail crossings, and freezes.';
