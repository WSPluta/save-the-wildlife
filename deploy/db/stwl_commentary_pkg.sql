CREATE OR REPLACE PACKAGE stwl_commentary_pkg AUTHID DEFINER AS
  FUNCTION build_script_json(
    p_session_id         IN VARCHAR2,
    p_player_id          IN VARCHAR2,
    p_max_chars          IN NUMBER   DEFAULT 200,
    p_select_ai_profile  IN VARCHAR2 DEFAULT 'STWL_GAMEPLAY_AI',
    p_agent_team_name    IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB;
END stwl_commentary_pkg;
/

CREATE OR REPLACE PACKAGE BODY stwl_commentary_pkg AS
  FUNCTION clamp_text(p_text IN CLOB, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_text  VARCHAR2(32767) := REGEXP_REPLACE(DBMS_LOB.SUBSTR(NVL(p_text, 'Clean run. SQL telemetry had the final word.'), 32000, 1), '[[:space:]]+', ' ');
    v_limit PLS_INTEGER := LEAST(200, GREATEST(40, NVL(p_max_chars, 200)));
  BEGIN
    IF REGEXP_LIKE(v_text, '(^|[^[:alnum:]_])(fuck|shit|bitch|asshole|bastard|dick|cunt)([^[:alnum:]_]|$)', 'i') THEN
      v_text := 'Strong run. The highlight stays conference-safe.';
    END IF;
    IF LENGTH(v_text) > v_limit THEN
      v_text := RTRIM(SUBSTR(v_text, 1, v_limit - 3)) || '...';
    END IF;
    RETURN v_text;
  END;

  FUNCTION session_summary_json(p_session_id IN VARCHAR2, p_player_id IN VARCHAR2) RETURN CLOB IS
    v_sql     CLOB;
    v_summary CLOB;
  BEGIN
    v_sql := q'[
      WITH params AS (
        SELECT :session_id AS session_id, :player_id AS player_id FROM dual
      ),
      base AS (
        SELECT e.session_id,
               MAX(e.room_id) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS room_id,
               e.player_id,
               MAX(e.player_name) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS player_name,
               NVL(COALESCE(
                 MAX(CASE
                   WHEN e.event_type = 'game_over'
                    AND COALESCE(JSON_VALUE(e.metadata_json, '$.score_source'), JSON_VALUE(e.metadata_json, '$.scoreSource')) = 'server_room_state'
                   THEN e.score
                 END) KEEP (DENSE_RANK LAST ORDER BY CASE
                   WHEN e.event_type = 'game_over'
                    AND COALESCE(JSON_VALUE(e.metadata_json, '$.score_source'), JSON_VALUE(e.metadata_json, '$.scoreSource')) = 'server_room_state'
                   THEN e.occurred_at
                 END NULLS FIRST),
                 MAX(CASE WHEN e.event_type = 'game_over' AND e.score <> 0 THEN e.score END)
                   KEEP (DENSE_RANK LAST ORDER BY CASE WHEN e.event_type = 'game_over' AND e.score <> 0 THEN e.occurred_at END NULLS FIRST),
                 MAX(CASE WHEN e.event_type <> 'game_over' AND e.score IS NOT NULL THEN e.score END)
                   KEEP (DENSE_RANK LAST ORDER BY CASE WHEN e.event_type <> 'game_over' AND e.score IS NOT NULL THEN e.occurred_at END NULLS FIRST),
                 MAX(CASE WHEN e.event_type = 'game_over' THEN e.score END)
                   KEEP (DENSE_RANK LAST ORDER BY CASE WHEN e.event_type = 'game_over' AND e.score IS NOT NULL THEN e.occurred_at END NULLS FIRST),
                 MAX(e.score) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at)
               ), 0) AS score,
               SUM(CASE WHEN e.event_type = 'trash_collected' THEN 1 ELSE 0 END) AS trash_collected,
               SUM(CASE WHEN e.event_type = 'marine_hit' THEN 1 ELSE 0 END) AS marine_hits,
               SUM(CASE WHEN e.event_type = 'trail_crossed' THEN 1 ELSE 0 END) AS trail_crosses,
               SUM(CASE WHEN e.event_type = 'player_frozen' THEN 1 ELSE 0 END) AS freezes,
               MAX(e.x) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_x,
               MAX(e.y) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_y,
               MAX(e.z) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_z
          FROM stwl_game_events e
          JOIN params p ON p.session_id = e.session_id AND p.player_id = e.player_id
         GROUP BY e.session_id, e.player_id
      ),
      powerups AS (
        SELECT JSON_OBJECTAGG(KEY powerup_type VALUE cnt RETURNING CLOB) AS powerups_json
          FROM (
            SELECT COALESCE(JSON_VALUE(e.metadata_json, '$.powerup_type'), 'powerup') AS powerup_type,
                   COUNT(*) AS cnt
              FROM stwl_game_events e
              JOIN params p ON p.session_id = e.session_id AND p.player_id = e.player_id
             WHERE e.event_type = 'powerup_collected'
             GROUP BY COALESCE(JSON_VALUE(e.metadata_json, '$.powerup_type'), 'powerup')
          )
      ),
      history AS (
        SELECT MAX(e.score) AS prior_best_score
          FROM stwl_game_events e
          JOIN params p ON p.player_id = e.player_id
         WHERE e.event_type = 'game_over'
           AND e.session_id <> p.session_id
      )
      SELECT JSON_OBJECT(
               'session_id' VALUE b.session_id,
               'room_id' VALUE b.room_id,
               'player_id' VALUE b.player_id,
               'player_name' VALUE NVL(b.player_name, 'Player'),
               'score' VALUE b.score,
               'trash_collected' VALUE b.trash_collected,
               'marine_hits' VALUE b.marine_hits,
               'trail_crosses' VALUE b.trail_crosses,
               'freezes' VALUE b.freezes,
               'powerups' VALUE COALESCE(p.powerups_json, TO_CLOB('{}')) FORMAT JSON,
               'last_position' VALUE JSON_OBJECT('x' VALUE b.last_x, 'y' VALUE b.last_y, 'z' VALUE b.last_z RETURNING CLOB) FORMAT JSON,
               'prior_best_score' VALUE h.prior_best_score
               RETURNING CLOB
             )
        FROM base b
        CROSS JOIN powerups p
        CROSS JOIN history h
    ]';
    EXECUTE IMMEDIATE v_sql INTO v_summary USING p_session_id, p_player_id;
    RETURN v_summary;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN NULL;
  END;

  FUNCTION deterministic_script(p_summary IN CLOB, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_score    NUMBER := NVL(JSON_VALUE(p_summary, '$.score' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_trash    NUMBER := NVL(JSON_VALUE(p_summary, '$.trash_collected' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_hits     NUMBER := NVL(JSON_VALUE(p_summary, '$.marine_hits' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_trails   NUMBER := NVL(JSON_VALUE(p_summary, '$.trail_crosses' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_freezes  NUMBER := NVL(JSON_VALUE(p_summary, '$.freezes' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_powerups VARCHAR2(4000) := NVL(JSON_QUERY(p_summary, '$.powerups'), '{}');
    v_prior    VARCHAR2(64) := JSON_VALUE(p_summary, '$.prior_best_score');
  BEGIN
    IF v_freezes > 0 THEN
      RETURN clamp_text('Trail drama: frozen ' || v_freezes || 'x after ' || v_trails || ' crossing(s), finished ' || v_score || '.', p_max_chars);
    ELSIF v_powerups <> '{}' THEN
      RETURN clamp_text('Powerup run: SQL saw boosts on the way to ' || v_score || ' points.', p_max_chars);
    ELSIF v_prior IS NOT NULL THEN
      RETURN clamp_text('Score ' || v_score || ' against prior best ' || v_prior || '. SQL history has the receipts.', p_max_chars);
    ELSIF v_hits > 0 THEN
      RETURN clamp_text(v_score || ' points with ' || v_hits || ' marine hit(s). Fast route, costly contact.', p_max_chars);
    END IF;
    RETURN clamp_text(v_score || ' points and ' || v_trash || ' clean pickups. Smooth telemetry, tidy finish.', p_max_chars);
  END;

  FUNCTION build_prompt(p_summary IN CLOB) RETURN CLOB IS
  BEGIN
    RETURN 'Use only this Save the Wildlife SQL telemetry JSON. Return exactly one short commentator sentence under 200 characters and no prefix. Never invent events. Do not use the words trail, crossing, freeze, frozen, powerup, shield, magnet, speed, boost, win, victory, policy, or trained unless the JSON has a non-zero matching count. If score and pickups are zero, say only the recorded score/pickup result or coordinates. JSON: ' || p_summary;
  END;

  FUNCTION score_safe_text(p_text IN VARCHAR2, p_summary IN CLOB) RETURN BOOLEAN IS
    v_text VARCHAR2(32767) := LOWER(NVL(p_text, ''));
    v_score VARCHAR2(64) := JSON_VALUE(p_summary, '$.score');
    v_score_pattern VARCHAR2(128);
  BEGIN
    IF v_score IS NULL THEN
      RETURN TRUE;
    END IF;
    IF NOT REGEXP_LIKE(v_text, '(^|[^[:alnum:]_])(score|scored|points?|finished|ending|ended)([^[:alnum:]_]|$)', 'i') THEN
      RETURN TRUE;
    END IF;
    v_score_pattern := REPLACE(v_score, '-', '\-');
    RETURN REGEXP_LIKE(v_text, '(^|[^[:digit:]-])' || v_score_pattern || '([^[:digit:]]|$)');
  END;

  FUNCTION select_ai_script(p_summary IN CLOB, p_profile IN VARCHAR2, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_result CLOB;
    v_prompt CLOB := build_prompt(p_summary);
    v_text   VARCHAR2(4000);
  BEGIN
    IF p_profile IS NULL THEN
      RETURN NULL;
    END IF;
    EXECUTE IMMEDIATE q'[
      BEGIN
        :result := DBMS_CLOUD_AI.GENERATE(
          prompt       => :prompt,
          profile_name => :profile_name,
          action       => 'chat'
        );
      END;]' USING OUT v_result, IN v_prompt, IN p_profile;
    v_text := clamp_text(v_result, p_max_chars);
    IF NOT score_safe_text(v_text, p_summary) THEN
      RETURN NULL;
    END IF;
    RETURN v_text;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  FUNCTION agent_team_script(p_summary IN CLOB, p_team_name IN VARCHAR2, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_result CLOB;
    v_prompt CLOB := build_prompt(p_summary);
    v_params VARCHAR2(4000);
    v_text   VARCHAR2(4000);
  BEGIN
    IF p_team_name IS NULL THEN
      RETURN NULL;
    END IF;
    v_params := JSON_OBJECT('conversation_id' VALUE 'stwl-' || RAWTOHEX(SYS_GUID()));
    EXECUTE IMMEDIATE q'[
      BEGIN
        :result := DBMS_CLOUD_AI_AGENT.RUN_TEAM(
          team_name    => :team_name,
          user_prompt  => :prompt,
          params       => :params
        );
      END;]' USING OUT v_result, IN p_team_name, IN v_prompt, IN v_params;
    v_text := clamp_text(v_result, p_max_chars);
    IF NOT score_safe_text(v_text, p_summary) THEN
      RETURN NULL;
    END IF;
    RETURN v_text;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  FUNCTION build_script_json(
    p_session_id         IN VARCHAR2,
    p_player_id          IN VARCHAR2,
    p_max_chars          IN NUMBER   DEFAULT 200,
    p_select_ai_profile  IN VARCHAR2 DEFAULT 'STWL_GAMEPLAY_AI',
    p_agent_team_name    IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB IS
    v_summary CLOB;
    v_text    VARCHAR2(4000);
    v_source  VARCHAR2(64) := 'oracle-ai-database-deterministic';
  BEGIN
    v_summary := session_summary_json(p_session_id, p_player_id);
    IF v_summary IS NULL THEN
      RETURN JSON_OBJECT('ok' VALUE 0, 'source' VALUE 'oracle-ai-database', 'error' VALUE 'session_not_found');
    END IF;

    v_text := select_ai_script(v_summary, p_select_ai_profile, p_max_chars);
    IF v_text IS NOT NULL THEN
      v_source := 'select-ai';
    ELSE
      v_text := agent_team_script(v_summary, p_agent_team_name, p_max_chars);
      IF v_text IS NOT NULL THEN
        v_source := 'oracle-ai-database-agent';
      ELSE
        v_text := deterministic_script(v_summary, p_max_chars);
      END IF;
    END IF;

    RETURN JSON_OBJECT(
      'ok' VALUE 1,
      'source' VALUE v_source,
      'commentary' VALUE v_text,
      'summary' VALUE v_summary FORMAT JSON
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'ok' VALUE 0,
        'source' VALUE 'oracle-ai-database-error',
        'error' VALUE SUBSTR(SQLERRM, 1, 500)
      );
  END;
END stwl_commentary_pkg;
/
