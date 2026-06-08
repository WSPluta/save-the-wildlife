-- Run after creating the stwl_game_events schema objects and an AI credential.
-- Replace STWL_AI_CRED with the DBMS_CLOUD credential configured for your provider.

BEGIN
  DBMS_CLOUD_AI.CREATE_PROFILE(
    profile_name => 'STWL_GAMEPLAY_AI',
    attributes   => '{
      "provider": "oci",
      "credential_name": "STWL_AI_CRED",
      "object_list": [
        { "owner": "' || USER || '", "name": "STWL_GAME_EVENTS" },
        { "owner": "' || USER || '", "name": "STWL_SESSION_SUMMARY" }
      ],
      "comments": true,
      "temperature": 0
    }'
  );
END;
/

-- Example presenter prompts:
-- EXEC DBMS_CLOUD_AI.SET_PROFILE('STWL_GAMEPLAY_AI');
-- SELECT AI NARRATE summarize the latest Save the Wildlife session and mention powerups and freezes;
-- SELECT AI SHOWSQL which players were frozen most often by crossing another player's trail;
