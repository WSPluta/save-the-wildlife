package com.oracle.developer.multiplayer.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Field;

import com.oracle.developer.multiplayer.score.data.GameEvent;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.SequenceGenerator;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ScoreApplicationTests {

	@Test
	void contextLoads() {
	}

	@Test
	void gameEventsUseTheExistingOracleSequence() throws Exception {
		Field idField = GameEvent.class.getDeclaredField("id");
		GeneratedValue generatedValue = idField.getAnnotation(GeneratedValue.class);
		SequenceGenerator sequenceGenerator = idField.getAnnotation(SequenceGenerator.class);

		assertThat(generatedValue.strategy()).isEqualTo(GenerationType.SEQUENCE);
		assertThat(generatedValue.generator()).isEqualTo("stwlGameEventsSeq");
		assertThat(sequenceGenerator.sequenceName()).isEqualTo("STWL_GAME_EVENTS_SEQ");
		assertThat(sequenceGenerator.allocationSize()).isEqualTo(1);
	}

}
