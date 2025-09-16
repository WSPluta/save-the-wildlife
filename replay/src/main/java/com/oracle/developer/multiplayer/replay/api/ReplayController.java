package com.oracle.developer.multiplayer.replay.api;

import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.ObjectMapper;

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
            sodaRepository.insertDocument(collection, json);
            Map<String, Object> ok = new HashMap<>();
            ok.put("ok", true);
            ok.put("collection", collection);
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
            "    c := dbms_soda.create_collection(:1);\n" +
            "  end if;\n" +
            "  c.insert(dbms_soda.document_t.parse(:2));\n" +
            "end;";
        try (Connection conn = dataSource.getConnection();
             CallableStatement cs = conn.prepareCall(plsql)) {
            cs.setString(1, collectionName);
            cs.setString(2, json);
            cs.execute();
        }
    }
}
