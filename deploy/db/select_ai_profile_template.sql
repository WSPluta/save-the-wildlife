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
        { "owner": "' || USER || '", "name": "STWL_SESSION_SUMMARY" }
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
