package com.oracle.developer.multiplayer.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import com.oracle.developer.multiplayer.score.dao.CurrentScoreDAO;
import com.oracle.developer.multiplayer.score.dao.ScoreOperationDAO;
import com.oracle.developer.multiplayer.score.data.CurrentScore;
import com.oracle.developer.multiplayer.score.data.Score;
import com.oracle.developer.multiplayer.score.data.ScoreOperationType;
import com.oracle.developer.multiplayer.score.repository.CurrentScoreRepository;
import com.oracle.developer.multiplayer.score.repository.ScoreRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CurrentScoreControllerTest {
    @Mock
    private CurrentScoreRepository currentScoreRepository;

    @Mock
    private ScoreRepository scoreRepository;

    @Test
    void doesNotPromoteSyntheticCollectorsIntoTopScores() {
        when(currentScoreRepository.findAllByUuid("u1")).thenReturn(
                List.of(),
                List.of(new CurrentScore("u1", "TrashCollector", 1L))
        );

        CurrentScoreController controller = new CurrentScoreController(currentScoreRepository, scoreRepository);
        CurrentScoreDAO result = controller.addScore(
                "u1",
                new ScoreOperationDAO("TrashCollector", ScoreOperationType.INCREMENT)
        );

        assertThat(result.getScore()).isEqualTo(1L);
        verify(scoreRepository, never()).findByUuid(any());
        verify(scoreRepository, never()).save(any());
    }

    @Test
    void promotesRealPlayersIntoTopScores() {
        when(currentScoreRepository.findAllByUuid("u2")).thenReturn(
                List.of(),
                List.of(new CurrentScore("u2", "Wojtek", 1L))
        );
        when(scoreRepository.findByUuid(eq("u2"))).thenReturn(Optional.empty());

        CurrentScoreController controller = new CurrentScoreController(currentScoreRepository, scoreRepository);
        controller.addScore("u2", new ScoreOperationDAO("Wojtek", ScoreOperationType.INCREMENT));

        ArgumentCaptor<Score> score = ArgumentCaptor.forClass(Score.class);
        verify(scoreRepository).save(score.capture());
        assertThat(score.getValue().getName()).isEqualTo("Wojtek");
        assertThat(score.getValue().getScore()).isEqualTo(1L);
    }
}
