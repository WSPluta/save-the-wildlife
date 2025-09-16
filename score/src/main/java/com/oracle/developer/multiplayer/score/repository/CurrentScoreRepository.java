package com.oracle.developer.multiplayer.score.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.CrudRepository;

import com.oracle.developer.multiplayer.score.data.CurrentScore;

public interface
CurrentScoreRepository extends CrudRepository<CurrentScore, Long> {
    List<CurrentScore> findAll(Pageable pageable);

    Optional<CurrentScore> findByUuid(String uuid);

    List<CurrentScore> findAllByUuid(String uuid);

    void deleteByUuid(String uuid);

    void deleteAll();
}
