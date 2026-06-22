package com.oracle.developer.multiplayer.score;

import java.util.Locale;

import com.oracle.developer.multiplayer.score.data.Score;

final class ScoreVisibilityPolicy {
    static final int PUBLIC_LEADERBOARD_LIMIT = 10;
    static final int PUBLIC_LEADERBOARD_SCAN_LIMIT = 100;

    private ScoreVisibilityPolicy() {
    }

    static boolean isPublicScore(Score score) {
        return score != null && isPublicScoreName(score.getName());
    }

    static boolean isPublicScoreName(String name) {
        String normalized = normalize(name);
        if (normalized.isEmpty()) return false;
        if (normalized.contains("smoke")) return false;
        if (normalized.contains("test")) return false;
        if (normalized.equals("player")) return false;
        return !normalized.startsWith("trashcollector") &&
                !normalized.startsWith("trashrecheck") &&
                !normalized.startsWith("incidentcollector") &&
                !normalized.startsWith("devcyclerunner") &&
                !normalized.startsWith("devcycleender") &&
                !normalized.startsWith("mobilepolish") &&
                !normalized.startsWith("arcadeenv") &&
                !normalized.startsWith("obssmoke") &&
                !normalized.startsWith("restarttester");
    }

    private static String normalize(String value) {
        return String.valueOf(value == null ? "" : value)
                .trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "");
    }
}
