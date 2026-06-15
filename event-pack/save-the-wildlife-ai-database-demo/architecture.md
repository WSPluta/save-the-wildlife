# Current Architecture After Redis Removal

This is the current Save the Wildlife demo architecture after removing Redis
from the real-time stack. Socket.IO clustering now uses Oracle Coherence as the
fanout bus for multi-pod `ws-server` deployments; local and single-pod
development can still use the in-memory backend.

The important demo message stays the same: Canvas lets business users shape the
agent experience, while the endpoint harness keeps it connected to governed
data, deterministic tools, live gameplay, and production controls.

## Runtime Topology

```mermaid
flowchart LR
  classDef client fill:#0f172a,stroke:#38bdf8,color:#ffffff
  classDef edge fill:#164e63,stroke:#67e8f9,color:#ffffff
  classDef service fill:#052e2b,stroke:#2dd4bf,color:#ffffff
  classDef state fill:#14532d,stroke:#86efac,color:#ffffff
  classDef ai fill:#581c87,stroke:#d8b4fe,color:#ffffff
  classDef removed fill:#450a0a,stroke:#fca5a5,color:#ffffff

  subgraph Clients["Players and presenter"]
    Browser["3D browser clients<br/>mobile + desktop"]
    Presenter["Presenter checks<br/>/paf health + commentary"]
  end

  subgraph Edge["OKE ingress"]
    Ingress["NGINX ingress<br/>/, /socket.io, /api, /api/replay, /paf"]
  end

  subgraph Workloads["OKE workloads"]
    Web["web<br/>Three.js static app"]
    Ws["ws-server<br/>Socket.IO + authoritative game loop"]
    Coherence["Oracle Coherence<br/>Socket.IO fanout map: socketEvents"]
    Score["score<br/>scores + game-events API"]
    Replay["replay<br/>replay clip API"]
    PAF["private-agent-factory<br/>Canvas endpoint harness"]
  end

  subgraph DataAI["Governed data and AI"]
    DB["Oracle AI Database<br/>events, summaries, replay, graph, memory"]
    SelectAI["Select AI / in-db agent team<br/>bounded SQL draft"]
    Canvas["Private Agent Factory Canvas<br/>published run endpoint"]
    GenAI["OCI Generative AI<br/>model inference"]
  end

  Redis["Redis<br/>removed from runtime path"]

  Browser -->|"GET /"| Ingress
  Presenter -->|"curl /paf/*"| Ingress
  Ingress -->|"static assets"| Web
  Browser <-->|"Socket.IO /socket.io"| Ingress
  Ingress -->|"real-time traffic"| Ws

  Ws <-->|"cluster fanout, TTL bounded"| Coherence
  Ws -.->|"Redis adapter no longer used"| Redis

  Ws -->|"scores + gameplay events"| Score
  Ws -.->|"direct DB fallback for events"| DB
  Score -->|"persist STWL_GAME_EVENTS"| DB
  Browser -->|"replay JSON"| Ingress
  Ingress -->|"/api/replay"| Replay
  Replay -->|"clip manifests"| DB

  Ingress -->|"/paf/*"| PAF
  Ws -->|"game_over commentary request"| PAF
  PAF -->|"SQL, JSON, graph, vector context"| DB
  PAF -->|"optional bounded draft"| SelectAI
  SelectAI -->|"model call"| GenAI
  PAF -->|"bounded evidence package"| Canvas
  Canvas -->|"model call"| GenAI
  PAF -->|"commentary response"| Ws
  Ws -->|"commentary.ready"| Browser

  class Browser,Presenter client
  class Ingress edge
  class Web,Ws,Score,Replay,PAF service
  class Coherence,DB state
  class SelectAI,Canvas,GenAI ai
  class Redis removed
```

## Game-Over Commentary Sequence

```mermaid
sequenceDiagram
  participant Client as "3D browser client"
  participant WS as "ws-server"
  participant Score as "score service"
  participant DB as "Oracle AI Database"
  participant PAF as "private-agent-factory harness"
  participant SelectAI as "Select AI / in-db agent"
  participant Canvas as "PAF Canvas agent"

  Client->>WS: game.event(game_over)
  WS->>Score: POST /api/game-events
  Score->>DB: Insert STWL_GAME_EVENTS
  WS->>PAF: POST /api/commentary
  PAF->>DB: Build SQL/JSON/graph/vector evidence
  PAF->>SelectAI: Optional bounded SQL-grounded draft
  SelectAI-->>PAF: Draft or warning
  PAF->>Canvas: Bounded evidence package for final phrasing
  Canvas-->>PAF: Short governed commentary
  PAF-->>WS: source=paf-canvas, fallback_source=select-ai
  WS-->>Client: commentary.ready
```

## Post-Redis Rules

- `REALTIME_CLUSTER_BACKEND=coherence` is the production multi-replica path.
- `REALTIME_CLUSTER_BACKEND=memory` is acceptable for local or single-pod use.
- `REALTIME_CLUSTER_BACKEND=redis` is intentionally invalid and covered by a
  regression test.
- Coherence fanout entries are TTL-bounded and payload-capped through
  `COHERENCE_SOCKET_BUS_TTL_MS` and
  `COHERENCE_SOCKET_EVENT_MAX_PAYLOAD_BYTES`.
- The Canvas connection remains inside the `private-agent-factory` harness; it
  is not a detached manual side path.
