package com.oracle.developer.multiplayer.score.dao;

public class CurrentScoreDAO {

    private String uuid;
    private String name;
    private Long score;

    public CurrentScoreDAO() {
    }

    public CurrentScoreDAO(String uuid, String name, Long score) {
        this.uuid = uuid;
        this.name = name;
        this.score = score;
    }

    public String getUuid() {
        return uuid;
    }

    public void setUuid(String uuid) {
        this.uuid = uuid;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getScore() {
        return score;
    }

    public void setScore(Long score) {
        this.score = score;
    }
}
