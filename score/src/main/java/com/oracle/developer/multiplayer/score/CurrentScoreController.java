package com.oracle.developer.multiplayer.score;

import java.util.List;
import java.util.Optional;

import jakarta.transaction.Transactional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.oracle.developer.multiplayer.score.dao.CurrentScoreDAO;
import com.oracle.developer.multiplayer.score.dao.ScoreOperationDAO;
import com.oracle.developer.multiplayer.score.data.CurrentScore;
import com.oracle.developer.multiplayer.score.data.Score;
import com.oracle.developer.multiplayer.score.data.ScoreOperationType;
import com.oracle.developer.multiplayer.score.repository.CurrentScoreRepository;
import com.oracle.developer.multiplayer.score.repository.ScoreRepository;

@RestController
public class CurrentScoreController {
    private static final Logger logger = LoggerFactory.getLogger(CurrentScoreController.class);

    private final CurrentScoreRepository currentScoreRepository;
    private final ScoreRepository scoreRepository;

    public CurrentScoreController(CurrentScoreRepository currentScoreRepository, ScoreRepository scoreRepository) {
        this.currentScoreRepository = currentScoreRepository;
        this.scoreRepository = scoreRepository;
    }

    @GetMapping("/api/score/{uuid}")
    public CurrentScoreDAO getByUuid(@PathVariable("uuid") String uuid) {
        logger.info("GET /api/score/" + uuid);
        CurrentScore score = deduplicateCurrentScores(uuid);
        if (score == null) throw new NotAuthorizedOrNotFound();
        return new CurrentScoreDAO(score.getUuid(), score.getName(), score.getScore());
    }

    @PutMapping("/api/score/{uuid}")
    public CurrentScoreDAO addScore(@PathVariable("uuid") String uuid, @RequestBody ScoreOperationDAO body) {
        logger.info("PUT /api/score/" + uuid);
        CurrentScore scoreFromStore = deduplicateCurrentScores(uuid);
        if (scoreFromStore == null) {
            scoreFromStore = new CurrentScore(uuid, body.getName(), 0L);
        }

        if (body.getOperationType().equals(ScoreOperationType.INCREMENT)) {
            scoreFromStore.setScore(scoreFromStore.getScore() + 1L);
        } else {
            scoreFromStore.setScore(scoreFromStore.getScore() - 1L);
        }
        scoreFromStore.setName(body.getName());
        scoreFromStore.setUuid(uuid);
        currentScoreRepository.save(scoreFromStore);

        // Deduplicate again after save to ensure only one authoritative row remains
        CurrentScore authoritative = deduplicateCurrentScores(uuid);

        // Sync high score table with current score (create if missing, promote if >=)
        Optional<Score> existingTop = scoreRepository.findByUuid(uuid);
        Score top = existingTop.orElse(new Score(uuid, authoritative.getName(), 0L));
        Long cur = authoritative.getScore();
        Long best = top.getScore();
        boolean shouldUpsert = (cur != null) && (!existingTop.isPresent() || best == null || cur >= best);
        if (shouldUpsert) {
            top.setScore(cur != null ? cur : 0L);
            top.setName(authoritative.getName());
            scoreRepository.save(top);
        }

        return new CurrentScoreDAO(authoritative.getUuid(), authoritative.getName(), authoritative.getScore());
    }

    @DeleteMapping("/api/score/{uuid}")
    @Transactional
    public ResponseEntity<Void> deleteByUuid(@PathVariable("uuid") String uuid) {
        logger.info("DELETE /api/score/" + uuid);
        CurrentScore currentScoreFromStore = deduplicateCurrentScores(uuid);
        if (currentScoreFromStore == null) throw new NotAuthorizedOrNotFound();

        Score scoreFromStore = scoreRepository.findByUuid(uuid).orElse(new Score(uuid,
                currentScoreFromStore.getName(), 0L));
        if (currentScoreFromStore.getScore() > scoreFromStore.getScore()) {
            scoreFromStore.setScore(currentScoreFromStore.getScore());
            scoreFromStore.setName(currentScoreFromStore.getName());
            scoreRepository.save(scoreFromStore);
        }
        // Remove all rows for this uuid (in case duplicates existed)
        currentScoreRepository.deleteByUuid(uuid);
        return new ResponseEntity<>(HttpStatus.NO_CONTENT);
    }

    @DeleteMapping("/api/score")
    public ResponseEntity<Void> deleteAll() {
        logger.info("DELETE /api/score");
        currentScoreRepository.deleteAll();
        return new ResponseEntity<>(HttpStatus.NO_CONTENT);
    }

    /**
     * Ensure there is only one CurrentScore per uuid.
     * Keeps the entry with highest id as the authoritative row,
     * promotes score to the max across duplicates, and deletes the rest.
     * Returns the authoritative row or null if none.
     */
    private CurrentScore deduplicateCurrentScores(String uuid) {
        List<CurrentScore> all = currentScoreRepository.findAllByUuid(uuid);
        if (all == null || all.isEmpty()) return null;
        if (all.size() == 1) return all.get(0);

        // Select the row with the highest id as the authoritative one
        CurrentScore keep = all.get(0);
        for (int i = 1; i < all.size(); i++) {
            CurrentScore cs = all.get(i);
            if (cs.getId() != null && (keep.getId() == null || cs.getId() > keep.getId())) {
                keep = cs;
            }
        }

        // Promote score to the maximum across duplicates
        long maxScore = 0L;
        for (CurrentScore cs : all) {
            if (cs.getScore() != null && cs.getScore() > maxScore) maxScore = cs.getScore();
        }
        if (keep.getScore() == null || keep.getScore() < maxScore) {
            keep.setScore(maxScore);
            keep = currentScoreRepository.save(keep);
        }

        // Delete all others
        for (CurrentScore cs : all) {
            if (!cs.getId().equals(keep.getId())) {
                currentScoreRepository.delete(cs);
            }
        }
        return keep;
    }
}
