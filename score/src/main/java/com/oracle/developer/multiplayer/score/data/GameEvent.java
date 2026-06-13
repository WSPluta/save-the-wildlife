package com.oracle.developer.multiplayer.score.data;

import java.time.OffsetDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;

@Entity
@Table(name = "STWL_GAME_EVENTS")
public class GameEvent {
    @Id
    @SequenceGenerator(name = "stwlGameEventsSeq", sequenceName = "STWL_GAME_EVENTS_SEQ", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "stwlGameEventsSeq")
    private Long id;

    @Column(name = "SESSION_ID", nullable = false, length = 128)
    private String sessionId;

    @Column(name = "ROOM_ID", nullable = false, length = 64)
    private String roomId;

    @Column(name = "PLAYER_ID", nullable = false, length = 128)
    private String playerId;

    @Column(name = "PLAYER_NAME", length = 256)
    private String playerName;

    @Column(name = "EVENT_TYPE", nullable = false, length = 40)
    private String eventType;

    @Column(name = "OCCURRED_AT", nullable = false)
    private OffsetDateTime occurredAt;

    @Column(name = "SCORE")
    private Long score;

    @Column(name = "X")
    private Double x;

    @Column(name = "Y")
    private Double y;

    @Column(name = "Z")
    private Double z;

    @Column(name = "RELATED_PLAYER_ID", length = 128)
    private String relatedPlayerId;

    @Column(name = "RELATED_ITEM_ID", length = 128)
    private String relatedItemId;

    @Lob
    @Column(name = "METADATA_JSON")
    private String metadataJson;

    public Long getId() { return id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getRoomId() { return roomId; }
    public void setRoomId(String roomId) { this.roomId = roomId; }
    public String getPlayerId() { return playerId; }
    public void setPlayerId(String playerId) { this.playerId = playerId; }
    public String getPlayerName() { return playerName; }
    public void setPlayerName(String playerName) { this.playerName = playerName; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public OffsetDateTime getOccurredAt() { return occurredAt; }
    public void setOccurredAt(OffsetDateTime occurredAt) { this.occurredAt = occurredAt; }
    public Long getScore() { return score; }
    public void setScore(Long score) { this.score = score; }
    public Double getX() { return x; }
    public void setX(Double x) { this.x = x; }
    public Double getY() { return y; }
    public void setY(Double y) { this.y = y; }
    public Double getZ() { return z; }
    public void setZ(Double z) { this.z = z; }
    public String getRelatedPlayerId() { return relatedPlayerId; }
    public void setRelatedPlayerId(String relatedPlayerId) { this.relatedPlayerId = relatedPlayerId; }
    public String getRelatedItemId() { return relatedItemId; }
    public void setRelatedItemId(String relatedItemId) { this.relatedItemId = relatedItemId; }
    public String getMetadataJson() { return metadataJson; }
    public void setMetadataJson(String metadataJson) { this.metadataJson = metadataJson; }
}
