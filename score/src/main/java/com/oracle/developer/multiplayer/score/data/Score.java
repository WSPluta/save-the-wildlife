package com.oracle.developer.multiplayer.score.data;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;

@Entity
public class Score {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    private String uuid;
    private String name;
    private Long score;

    public Score() {
        this.uuid = "";
        this.name = "";
        this.score = 0L;
    }

    public Score(String uuid, String name, Long score) {
        this.uuid = uuid;
        this.name = name;
        this.score = score;
    }

    // Explicit getters/setters to avoid reliance on Lombok at compile-time
    public Long getId() { return id; }
    public String getUuid() { return uuid; }
    public void setUuid(String uuid) { this.uuid = uuid; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Long getScore() { return score; }
    public void setScore(Long score) { this.score = score; }
}
