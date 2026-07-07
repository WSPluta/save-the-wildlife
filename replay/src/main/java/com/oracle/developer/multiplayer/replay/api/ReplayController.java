package com.oracle.developer.multiplayer.replay.api;

import java.nio.charset.StandardCharsets;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.ObjectMapper;

/**
 * Replay API
 * - POST /api/replay/events: stores a replay document into an Oracle SODA collection using native JSON.
 *   The collection is auto-created on first insert if it doesn't exist.
 *
 * Notes:
 * - This uses DBMS_SODA PL/SQL to leverage Oracle Database Native JSON via SODA collections.
 * - Ensure your DB user has privileges for DBMS_SODA.
 * - Configure connection in replay/src/main/resources/application.properties (REPLAY_DB_* env supported).
 */
@RestController
@RequestMapping("/api/replay")
public class ReplayController {

    private static final String DEFAULT_COLLECTION = "REPLAY_EVENTS";
    private final SodaRepository sodaRepository;
    private final ObjectMapper mapper = new ObjectMapper();

    public ReplayController(SodaRepository sodaRepository) {
        this.sodaRepository = sodaRepository;
    }

    @PostMapping("/events")
    public ResponseEntity<Map<String, Object>> postEvent(@RequestBody Map<String, Object> body) {
        String collection = DEFAULT_COLLECTION;
        try {
            // Allow override via body.meta.collection (optional)
            try {
                Object meta = body.get("meta");
                if (meta instanceof Map) {
                    Object c = ((Map<?, ?>) meta).get("collection");
                    if (c != null) {
                        String s = String.valueOf(c).trim();
                        if (!s.isEmpty()) collection = s.toUpperCase();
                    }
                }
            } catch (Exception ignored) {}
            String json = mapper.writeValueAsString(body);
            if (!sodaRepository.isEnabled()) {
                Map<String, Object> ok = new HashMap<>();
                ok.put("ok", true);
                ok.put("collection", collection);
                ok.put("noop", true);
                return ResponseEntity.accepted().body(ok);
            }
            String sodaWarning = null;
            try {
                sodaRepository.insertDocument(collection, json);
            } catch (Exception sodaError) {
                sodaWarning = sodaError.getMessage();
            }
            String manifestWarning = null;
            try {
                sodaRepository.insertClipManifest(body, json);
            } catch (Exception manifestError) {
                manifestWarning = manifestError.getMessage();
            }
            Map<String, Object> ok = new HashMap<>();
            ok.put("ok", true);
            ok.put("collection", collection);
            if (sodaWarning != null) {
                ok.put("sodaWarning", sodaWarning);
            }
            if (manifestWarning != null) {
                ok.put("manifestWarning", manifestWarning);
            }
            return ResponseEntity.accepted().body(ok);
        } catch (Exception e) {
            Map<String, Object> err = new HashMap<>();
            err.put("ok", false);
            err.put("error", e.getMessage());
            return ResponseEntity.status(500).body(err);
        }
    }

    // Optional: Placeholder for fetching events by matchId (implementing SODA queries via PL/SQL is possible but verbose).
    // For now, returns 501 to indicate this can be added on demand.
    @GetMapping("/events")
    public ResponseEntity<Map<String, Object>> getEventsByMatchId(@RequestParam(name = "matchId", required = false) String matchId) {
        Map<String, Object> res = new HashMap<>();
        res.put("ok", false);
        res.put("error", "Not Implemented");
        res.put("hint", "Implement SODA filter query for matchId as needed.");
        return ResponseEntity.status(501).body(res);
    }
}

/**
 * Minimal SODA repository using DBMS_SODA PL/SQL to auto-create a collection and insert a JSON document.
 */
@Component
class SodaRepository {
    private final DataSource dataSource;

    private final boolean enabled;

    public SodaRepository(org.springframework.beans.factory.ObjectProvider<DataSource> dataSourceProvider) {
        this.dataSource = dataSourceProvider.getIfAvailable();
        this.enabled = this.dataSource != null;
    }

    public boolean isEnabled() { return enabled; }

    /**
     * Insert a JSON document into SODA collection (auto-creates collection if not present).
     * Requires DBMS_SODA privileges for the DB user.
     */
    public void insertDocument(String collectionName, String json) throws SQLException {
        if (!enabled) { return; }
        final String plsql =
            "declare\n" +
            "  c dbms_soda.collection_t;\n" +
            "begin\n" +
            "  c := dbms_soda.open_collection(:1);\n" +
            "  if c is null then\n" +
            "    c := dbms_soda.create_collection(:2);\n" +
            "  end if;\n" +
            "  c.insert_one(dbms_soda.document_t.parse(:3));\n" +
            "end;";
        try (Connection conn = dataSource.getConnection();
             CallableStatement cs = conn.prepareCall(plsql)) {
            cs.setString(1, collectionName);
            cs.setString(2, collectionName);
            cs.setString(3, json);
            cs.execute();
        }
    }

    public void insertClipManifest(Map<String, Object> body, String json) throws SQLException {
        if (!enabled) { return; }

        String sessionId = stringValue(first(body, "sessionId", "session_id"));
        if (sessionId.isEmpty()) sessionId = stringValue(nested(body, "event", "meta", "sessionId"));
        if (sessionId.isEmpty()) sessionId = stringValue(first(body, "room", "room_id", "roomId"));
        String roomId = stringValue(first(body, "room", "room_id", "roomId"));
        String playerId = stringValue(nested(body, "player", "id"));
        String playerName = stringValue(nested(body, "player", "name"));
        String eventType = stringValue(nested(body, "event", "type"));
        String eventAt = stringValue(nested(body, "event", "at"));
        if (sessionId.isEmpty() || eventType.isEmpty()) { return; }

        int frameCount = 0;
        Long startMs = null;
        Long endMs = null;
        Object clip = body.get("clip");
        if (clip instanceof Map) {
            Object frames = ((Map<?, ?>) clip).get("frames");
            if (frames instanceof List) {
                List<?> list = (List<?>) frames;
                frameCount = list.size();
                Long eventMs = parseEpochMillis(eventAt);
                Long firstMs = frameTimestamp(list.isEmpty() ? null : list.get(0));
                Long lastMs = frameTimestamp(list.isEmpty() ? null : list.get(list.size() - 1));
                if (eventMs != null && firstMs != null) startMs = firstMs - eventMs;
                if (eventMs != null && lastMs != null) endMs = lastMs - eventMs;
            }
        }

        String clipId = UUID.nameUUIDFromBytes(json.getBytes(StandardCharsets.UTF_8)).toString();
        String tagsJson = "{\"source\":\"replay-json\",\"event_type\":\"" + escapeJson(eventType) + "\"}";
        String metadataJson = "{\"collection\":\"REPLAY_EVENTS\",\"player_name\":\"" + escapeJson(playerName) + "\"}";

        try (Connection conn = dataSource.getConnection()) {
            ensureClipManifestTable(conn);
            final String sql =
                "MERGE INTO stwl_replay_clips c\n" +
                "USING (SELECT ? clip_id FROM dual) s\n" +
                "ON (c.clip_id = s.clip_id)\n" +
                "WHEN NOT MATCHED THEN INSERT (\n" +
                "  clip_id, session_id, room_id, player_id, event_type, event_at,\n" +
                "  timecode_start_ms, timecode_end_ms, frame_count, moderation_status,\n" +
                "  tags_json, metadata_json, replay_json\n" +
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, clipId);
                ps.setString(2, clipId);
                ps.setString(3, sessionId);
                ps.setString(4, roomId.isEmpty() ? null : roomId);
                ps.setString(5, playerId.isEmpty() ? null : playerId);
                ps.setString(6, eventType);
                OffsetDateTime eventTime = parseOffsetDateTime(eventAt);
                if (eventTime == null) ps.setNull(7, Types.TIMESTAMP_WITH_TIMEZONE);
                else ps.setObject(7, eventTime);
                if (startMs == null) ps.setNull(8, Types.NUMERIC);
                else ps.setLong(8, startMs);
                if (endMs == null) ps.setNull(9, Types.NUMERIC);
                else ps.setLong(9, endMs);
                ps.setInt(10, frameCount);
                ps.setString(11, tagsJson);
                ps.setString(12, metadataJson);
                ps.setString(13, json);
                ps.executeUpdate();
            }
        }
    }

    private void ensureClipManifestTable(Connection conn) throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.executeUpdate(
                "CREATE TABLE stwl_replay_clips (" +
                "clip_id VARCHAR2(128) PRIMARY KEY, " +
                "session_id VARCHAR2(128) NOT NULL, " +
                "room_id VARCHAR2(64), " +
                "player_id VARCHAR2(128), " +
                "event_type VARCHAR2(64) NOT NULL, " +
                "event_at TIMESTAMP WITH TIME ZONE, " +
                "clip_uri VARCHAR2(1024), " +
                "thumbnail_uri VARCHAR2(1024), " +
                "timecode_start_ms NUMBER, " +
                "timecode_end_ms NUMBER, " +
                "frame_count NUMBER, " +
                "moderation_status VARCHAR2(32) DEFAULT 'approved' NOT NULL, " +
                "tags_json CLOB CHECK (tags_json IS JSON), " +
                "metadata_json CLOB CHECK (metadata_json IS JSON), " +
                "replay_json CLOB CHECK (replay_json IS JSON), " +
                "created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL" +
                ")"
            );
        } catch (SQLException e) {
            if (!String.valueOf(e.getMessage()).contains("ORA-00955")) throw e;
        }
        try (Statement st = conn.createStatement()) {
            st.executeUpdate("CREATE INDEX stwl_replay_clips_session_ix ON stwl_replay_clips (session_id, event_at)");
        } catch (SQLException e) {
            if (!String.valueOf(e.getMessage()).contains("ORA-00955")) throw e;
        }
    }

    private static Object first(Map<String, Object> body, String... keys) {
        for (String key : keys) {
            Object value = body.get(key);
            if (value != null) return value;
        }
        return null;
    }

    private static Object nested(Map<String, Object> body, String... path) {
        Object current = body;
        for (String key : path) {
            if (!(current instanceof Map)) return null;
            current = ((Map<?, ?>) current).get(key);
            if (current == null) return null;
        }
        return current;
    }

    private static String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private static String escapeJson(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static OffsetDateTime parseOffsetDateTime(String value) {
        try {
            return value == null || value.isEmpty() ? null : OffsetDateTime.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Long parseEpochMillis(String value) {
        OffsetDateTime parsed = parseOffsetDateTime(value);
        return parsed == null ? null : parsed.toInstant().toEpochMilli();
    }

    private static Long frameTimestamp(Object frame) {
        if (!(frame instanceof Map)) return null;
        Object ts = ((Map<?, ?>) frame).get("ts");
        if (ts instanceof Number) return ((Number) ts).longValue();
        try {
            return ts == null ? null : Long.parseLong(String.valueOf(ts));
        } catch (Exception ignored) {
            return null;
        }
    }
}
