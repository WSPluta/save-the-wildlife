package com.oracle.developer.multiplayer.score;

import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.oracle.developer.multiplayer.score.data.GameEvent;
import com.oracle.developer.multiplayer.score.repository.GameEventRepository;

@RestController
public class GameEventController {
    private static final Logger logger = LoggerFactory.getLogger(GameEventController.class);
    private static final Set<String> EVENT_TYPES = new HashSet<>(Arrays.asList(
            "game_started",
            "position_sample",
            "trash_collected",
            "marine_hit",
            "powerup_collected",
            "trail_crossed",
            "player_frozen",
            "game_over"));

    private final GameEventRepository gameEventRepository;
    private final ObjectMapper objectMapper;

    public GameEventController(GameEventRepository gameEventRepository, ObjectMapper objectMapper) {
        this.gameEventRepository = gameEventRepository;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/api/game-events")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        String eventType = text(body.get("event_type"));
        String sessionId = text(body.get("session_id"));
        String roomId = text(body.get("room_id"));
        String playerId = text(body.get("player_id"));
        if (!EVENT_TYPES.contains(eventType) || sessionId.isEmpty() || roomId.isEmpty() || playerId.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "invalid_game_event"));
        }

        GameEvent event = new GameEvent();
        event.setEventType(eventType);
        event.setSessionId(sessionId);
        event.setRoomId(roomId);
        event.setPlayerId(playerId);
        event.setPlayerName(text(body.get("player_name")));
        event.setOccurredAt(parseTime(text(body.get("occurred_at"))));
        event.setScore(longValue(body.get("score")));
        event.setX(doubleValue(body.get("x")));
        event.setY(doubleValue(body.get("y")));
        event.setZ(doubleValue(body.get("z")));
        event.setRelatedPlayerId(text(body.get("related_player_id")));
        event.setRelatedItemId(text(body.get("related_item_id")));
        event.setMetadataJson(metadataJson(body.get("metadata")));
        GameEvent saved = gameEventRepository.save(event);
        logger.debug("Stored gameplay event {} for player {}", eventType, playerId);
        return ResponseEntity.accepted().body(Map.of("ok", true, "id", saved.getId()));
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private OffsetDateTime parseTime(String value) {
        try {
            return value == null || value.isEmpty() ? OffsetDateTime.now() : OffsetDateTime.parse(value);
        } catch (Exception ignored) {
            return OffsetDateTime.now();
        }
    }

    private Long longValue(Object value) {
        if (value instanceof Number) return ((Number) value).longValue();
        try {
            return value == null ? null : Long.parseLong(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private Double doubleValue(Object value) {
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return value == null ? null : Double.parseDouble(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private String metadataJson(Object metadata) {
        if (metadata == null) return "{}";
        try {
            return objectMapper.writeValueAsString(metadata);
        } catch (JacksonException ignored) {
            return "{}";
        }
    }
}
