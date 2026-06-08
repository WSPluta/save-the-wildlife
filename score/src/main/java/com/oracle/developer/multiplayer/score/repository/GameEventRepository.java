package com.oracle.developer.multiplayer.score.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.oracle.developer.multiplayer.score.data.GameEvent;

public interface GameEventRepository extends JpaRepository<GameEvent, Long> {
    List<GameEvent> findTop100BySessionIdOrderByOccurredAtAsc(String sessionId);
}
