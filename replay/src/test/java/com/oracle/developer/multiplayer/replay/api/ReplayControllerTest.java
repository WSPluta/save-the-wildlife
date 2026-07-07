package com.oracle.developer.multiplayer.replay.api;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.ObjectProvider;

class ReplayControllerTest {

    @Test
    void insertDocumentBindsRepeatedCollectionNameAndJson() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        CallableStatement statement = mock(CallableStatement.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<DataSource> provider = mock(ObjectProvider.class);

        when(provider.getIfAvailable()).thenReturn(dataSource);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.prepareCall(anyString())).thenReturn(statement);

        SodaRepository repository = new SodaRepository(provider);
        repository.insertDocument("REPLAY_EVENTS", "{\"ok\":true}");

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(connection).prepareCall(sql.capture());
        org.junit.jupiter.api.Assertions.assertTrue(sql.getValue().contains("insert_one"));
        org.junit.jupiter.api.Assertions.assertTrue(sql.getValue().contains("dbms_soda.create_collection(:2)"));
        verify(statement).setString(1, "REPLAY_EVENTS");
        verify(statement).setString(2, "REPLAY_EVENTS");
        verify(statement).setString(3, "{\"ok\":true}");
        verify(statement).execute();
    }

    @Test
    void postEventAcceptsReplayWhenSodaIsUnavailable() throws Exception {
        SodaRepository repository = mock(SodaRepository.class);
        when(repository.isEnabled()).thenReturn(true);
        doThrow(new SQLException("SODA unavailable")).when(repository).insertDocument(anyString(), anyString());

        ReplayController controller = new ReplayController(repository);
        ResponseEntity<Map<String, Object>> response = controller.postEvent(Map.of(
            "room", "QA-ROOM",
            "sessionId", "QA-ROOM:p1:s1",
            "event", Map.of("type", "trash_collected", "at", "2026-06-27T19:24:00Z"),
            "player", Map.of("id", "p1", "name", "Replay Probe")
        ));

        org.junit.jupiter.api.Assertions.assertEquals(202, response.getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals(true, response.getBody().get("ok"));
        org.junit.jupiter.api.Assertions.assertEquals("SODA unavailable", response.getBody().get("sodaWarning"));
        verify(repository).insertClipManifest(org.mockito.ArgumentMatchers.anyMap(), anyString());
    }
}
