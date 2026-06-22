package com.oracle.developer.multiplayer.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import com.oracle.developer.multiplayer.score.dao.ScoreDAO;
import com.oracle.developer.multiplayer.score.data.Score;
import com.oracle.developer.multiplayer.score.repository.ScoreRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class ScoreControllerTest {
    @Mock
    private ScoreRepository repository;

    @Test
    void filtersAutomationScoresAfterOverFetchingTopRows() {
        when(repository.findAll(any(Pageable.class))).thenReturn(new PageImpl<>(List.of(
                score("u1", "TrashCollector", 5L),
                score("u2", "TrashCollectorNow", 4L),
                score("u3", "Socket Trash Smoke", 4L),
                score("u4", "Ada", 3L),
                score("u5", "Wojtek", 2L)
        )));

        ScoreController controller = new ScoreController(repository);
        List<ScoreDAO> results = controller.getAll();

        assertThat(results).extracting(ScoreDAO::getName).containsExactly("Ada", "Wojtek");

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findAll(pageable.capture());
        assertThat(pageable.getValue().getPageSize()).isEqualTo(ScoreVisibilityPolicy.PUBLIC_LEADERBOARD_SCAN_LIMIT);
    }

    private static Score score(String uuid, String name, Long value) {
        return new Score(uuid, name, value);
    }
}
