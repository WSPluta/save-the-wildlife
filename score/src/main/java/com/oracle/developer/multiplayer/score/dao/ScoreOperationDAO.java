package com.oracle.developer.multiplayer.score.dao;

import com.oracle.developer.multiplayer.score.data.ScoreOperationType;

public class ScoreOperationDAO {

    private String name;
    private ScoreOperationType operationType;

    public ScoreOperationDAO() {
    }

    public ScoreOperationDAO(String name, ScoreOperationType operationType) {
        this.name = name;
        this.operationType = operationType;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public ScoreOperationType getOperationType() {
        return operationType;
    }

    public void setOperationType(ScoreOperationType operationType) {
        this.operationType = operationType;
    }
}
