-- Run after creating the stwl_game_events schema objects.
-- For OCI Generative AI with Autonomous Database resource principal, keep
-- OCI$RESOURCE_PRINCIPAL. If using an API-key credential instead, replace it
-- with the DBMS_CLOUD credential name configured for your provider.

BEGIN
  DBMS_CLOUD_ADMIN.ENABLE_RESOURCE_PRINCIPAL();
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
/

BEGIN
  DBMS_CLOUD_AI.CREATE_PROFILE(
    profile_name => 'STWL_GAMEPLAY_AI',
    attributes   => '{
      "provider": "oci",
      "credential_name": "OCI$RESOURCE_PRINCIPAL",
      "region": "uk-london-1",
      "model": "cohere.command-r-08-2024",
      "oci_apiformat": "COHERE",
      "object_list": [
        { "owner": "' || USER || '", "name": "STWL_GAME_EVENTS" },
        { "owner": "' || USER || '", "name": "STWL_SESSION_SUMMARY" },
        { "owner": "' || USER || '", "name": "STWL_EVENT_DOCUMENTS" },
        { "owner": "' || USER || '", "name": "STWL_GRAPH_VERTICES" },
        { "owner": "' || USER || '", "name": "STWL_GRAPH_EDGES" },
        { "owner": "' || USER || '", "name": "STWL_REPLAY_CLIPS" },
        { "owner": "' || USER || '", "name": "STWL_AGENT_MEMORIES" }
      ],
      "comments": true,
      "max_tokens": 512,
      "temperature": 0
    }'
  );
END;
/

-- Example presenter prompts:
-- EXEC DBMS_CLOUD_AI.SET_PROFILE('STWL_GAMEPLAY_AI');
-- SELECT AI NARRATE summarize the latest Save the Wildlife session and mention powerups and freezes;
-- SELECT AI SHOWSQL which players were frozen most often by crossing another player's trail;
-- SELECT AI NARRATE explain why the latest replay clip mattered using only recorded telemetry;
-- SELECT AI SHOWSQL find similar prior match memories for the latest player;
