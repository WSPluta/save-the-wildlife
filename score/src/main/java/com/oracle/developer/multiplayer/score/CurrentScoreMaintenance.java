package com.oracle.developer.multiplayer.score;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import javax.annotation.PostConstruct;
import javax.transaction.Transactional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.oracle.developer.multiplayer.score.data.CurrentScore;
import com.oracle.developer.multiplayer.score.repository.CurrentScoreRepository;

@Component
public class CurrentScoreMaintenance {

    private static final Logger logger = LoggerFactory.getLogger(CurrentScoreMaintenance.class);

    private final CurrentScoreRepository currentScoreRepository;

    public CurrentScoreMaintenance(CurrentScoreRepository currentScoreRepository) {
        this.currentScoreRepository = currentScoreRepository;
    }

    /**
     * One-time repair at service startup:
     * - For each uuid in CURRENT_SCORE, keep the row with the highest id
     * - Promote its score to the maximum score among duplicates
     * - Delete all other duplicate rows for that uuid
     *
     * This makes the table self-healing if it already contains multiple rows per uuid.
     */
    @PostConstruct
    @Transactional
    public void deduplicateAllCurrentScores() {
        int deleted = 0;
        int repaired = 0;
        try {
            Map<String, List<CurrentScore>> byUuid = new HashMap<>();
            for (CurrentScore cs : currentScoreRepository.findAll()) {
                String uuid = cs.getUuid() == null ? "" : cs.getUuid();
                byUuid.computeIfAbsent(uuid, k -> new ArrayList<>()).add(cs);
            }
            for (Map.Entry<String, List<CurrentScore>> entry : byUuid.entrySet()) {
                List<CurrentScore> list = entry.getValue();
                if (list == null || list.size() <= 1) continue;

                // Keep row with highest id
                CurrentScore keep = list.get(0);
                for (int i = 1; i < list.size(); i++) {
                    CurrentScore cs = list.get(i);
                    if (cs.getId() != null && (keep.getId() == null || cs.getId() > keep.getId())) {
                        keep = cs;
                    }
                }

                // Promote score to maximum among duplicates
                long maxScore = 0L;
                for (CurrentScore cs : list) {
                    if (cs.getScore() != null && cs.getScore() > maxScore) {
                        maxScore = cs.getScore();
                    }
                }
                if (keep.getScore() == null || keep.getScore() < maxScore) {
                    keep.setScore(maxScore);
                    currentScoreRepository.save(keep);
                    repaired++;
                }

                // Delete all other rows
                for (CurrentScore cs : list) {
                    if (!Objects.equals(cs.getId(), keep.getId())) {
                        currentScoreRepository.delete(cs);
                        deleted++;
                    }
                }
            }
            if (deleted > 0 || repaired > 0) {
                logger.info("CurrentScoreMaintenance: removed {} duplicate rows; repaired {} rows with max score.", deleted, repaired);
            } else {
                logger.info("CurrentScoreMaintenance: no duplicates found.");
            }
        } catch (Exception e) {
            logger.warn("CurrentScoreMaintenance dedup failed: {}", e.toString());
        }
    }
}
