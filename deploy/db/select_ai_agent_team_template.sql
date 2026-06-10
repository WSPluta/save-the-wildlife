-- Optional setup for the in-database Select AI Agent path.
-- Run after select_ai_profile_template.sql and after validating STWL_GAMEPLAY_AI.
-- The runtime package falls back to DBMS_CLOUD_AI.GENERATE or deterministic SQL
-- commentary if this team is not installed or if provider calls fail.

BEGIN
  DBMS_CLOUD_AI_AGENT.DROP_TEAM(team_name => 'STWL_GAMEPLAY_COMMENTARY_TEAM', force => TRUE);
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

BEGIN
  DBMS_CLOUD_AI_AGENT.DROP_TASK(task_name => 'STWL_COMMENTARY_TASK', force => TRUE);
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

BEGIN
  DBMS_CLOUD_AI_AGENT.DROP_TOOL(tool_name => 'STWL_GAMEPLAY_SQL_TOOL', force => TRUE);
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

BEGIN
  DBMS_CLOUD_AI_AGENT.DROP_AGENT(agent_name => 'STWL_COMMENTARY_AGENT', force => TRUE);
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

BEGIN
  DBMS_CLOUD_AI_AGENT.CREATE_TOOL(
    tool_name  => 'STWL_GAMEPLAY_SQL_TOOL',
    attributes => '{
      "tool_type": "SQL",
      "description": "Read-only SQL over Save the Wildlife telemetry views scoped by STWL_GAMEPLAY_AI.",
      "profile_name": "STWL_GAMEPLAY_AI"
    }'
  );

  DBMS_CLOUD_AI_AGENT.CREATE_TASK(
    task_name  => 'STWL_COMMENTARY_TASK',
    attributes => '{
      "description": "Produce one conference-safe Save the Wildlife commentator line under 200 characters from recorded SQL telemetry only.",
      "instructions": "Use only provided telemetry or read-only SQL tool results. Mention powerups, trail crossings, freezes, coordinates, or prior best only when present. Never invent events, players, animals, or history.",
      "tools": ["STWL_GAMEPLAY_SQL_TOOL"]
    }'
  );

  DBMS_CLOUD_AI_AGENT.CREATE_AGENT(
    agent_name => 'STWL_COMMENTARY_AGENT',
    attributes => '{
      "description": "Bounded Save the Wildlife in-database commentary agent.",
      "profile_name": "STWL_GAMEPLAY_AI",
      "tasks": ["STWL_COMMENTARY_TASK"]
    }'
  );

  DBMS_CLOUD_AI_AGENT.CREATE_TEAM(
    team_name  => 'STWL_GAMEPLAY_COMMENTARY_TEAM',
    attributes => '{
      "description": "Save the Wildlife gameplay commentary team.",
      "agents": ["STWL_COMMENTARY_AGENT"],
      "main_agent": "STWL_COMMENTARY_AGENT"
    }'
  );
END;
/
