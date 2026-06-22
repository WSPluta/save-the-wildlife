package com.oracle.developer.multiplayer.score;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ScoreVisibilityPolicyTest {
    @Test
    void keepsAutomationIdentitiesOutOfPublicScores() {
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("TrashCollector")).isFalse();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("TrashCollectorNow")).isFalse();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("TrashRecheck")).isFalse();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("IncidentCollector")).isFalse();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("Socket Trash Smoke")).isFalse();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("Player")).isFalse();
    }

    @Test
    void keepsRealAttendeeNamesVisible() {
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("Wojtek")).isTrue();
        assertThat(ScoreVisibilityPolicy.isPublicScoreName("Ada Lovelace")).isTrue();
    }
}
