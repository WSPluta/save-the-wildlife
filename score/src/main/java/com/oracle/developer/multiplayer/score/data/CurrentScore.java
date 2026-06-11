package com.oracle.developer.multiplayer.score.data;


import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
public class CurrentScore {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    Long id;

    String uuid;

    String name;

    Long score;

    public CurrentScore() {
        this.uuid = "";
        this.name = "";
        this.score = 0L;
    }

    public CurrentScore(String uuid, String name, Long score) {
        this.uuid = uuid;
        this.name = name;
        this.score = score;
    }

    // Explicit getters/setters to satisfy IDEs/builds without Lombok processing
    public Long getId() { return id; }
    public String getUuid() { return uuid; }
    public void setUuid(String uuid) { this.uuid = uuid; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Long getScore() { return score; }
    public void setScore(Long score) { this.score = score; }
}
