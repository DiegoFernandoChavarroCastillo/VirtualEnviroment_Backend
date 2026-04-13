# Requirements Document

## Introduction

El microservicio **peerly-realtime-management** gestiona la comunicación en tiempo real para la red social universitaria Peerly. Este microservicio maneja la presencia de usuarios en el mapa virtual, las actualizaciones de posiciones de avatares y el chat temporal, utilizando WebSocket (Socket.IO) para comunicación bidireccional y Redis para almacenamiento efímero.

## Glossary

- **Realtime_Service**: El microservicio completo que gestiona comunicación en tiempo real
- **Virtual_Map_Gateway**: El gateway WebSocket que maneja conexiones en el namespace /map
- **Avatar**: Representación visual del usuario en el mapa virtual
- **Position**: Coordenadas (x, y) del avatar en el mapa virtual
- **Presence**: Estado de conexión activa de un usuario en el mapa
- **Chat_Message**: Mensaje temporal enviado por un usuario en el mapa
- **Redis_Store**: Sistema de almacenamiento efímero basado en Redis
- **Auth_Guard**: Guardia de autenticación que valida tokens JWT en conexiones WebSocket
- **User_Management**: Microservicio externo que gestiona usuarios
- **Connection_Management**: Microservicio externo que gestiona conexiones entre usuarios
- **Redis_Adapter**: Adaptador de Socket.IO para escalabilidad horizontal con Redis
- **JWT_Token**: Token de autenticación JSON Web Token
- **Throttle**: Limitación de frecuencia de eventos para optimizar rendimiento

## Requirements

### Requirement 1: Autenticación WebSocket

**User Story:** Como desarrollador del sistema, quiero que las conexiones WebSocket estén autenticadas con JWT, para que solo usuarios válidos puedan acceder al mapa virtual.

#### Acceptance Criteria

1. WHEN a client attempts to connect to the /map namespace, THE Auth_Guard SHALL validate the JWT_Token from client.handshake.auth.token or client.handshake.headers.authorization
2. IF the JWT_Token is invalid or missing, THEN THE Virtual_Map_Gateway SHALL reject the connection with an authentication error
3. WHEN the JWT_Token is valid, THE Virtual_Map_Gateway SHALL extract user data and store it in client.data.user
4. THE Auth_Guard SHALL decode the JWT_Token and verify its signature before allowing connection

### Requirement 2: Gestión de Presencia de Usuarios

**User Story:** Como usuario, quiero que mi presencia en el mapa virtual sea registrada cuando me conecto, para que otros usuarios sepan que estoy activo.

#### Acceptance Criteria

1. WHEN a user successfully connects to the /map namespace, THE Realtime_Service SHALL create a Presence record in Redis_Store with userId, socketId, and timestamp
2. WHEN a user disconnects from the /map namespace, THE Realtime_Service SHALL remove the Presence record from Redis_Store
3. THE Realtime_Service SHALL broadcast a userJoined event to all connected clients when a user connects
4. THE Realtime_Service SHALL broadcast a userLeft event to all connected clients when a user disconnects
5. WHEN a joinMap event is received, THE Realtime_Service SHALL retrieve the user profile from User_Management via HTTP and include it in the userJoined broadcast

### Requirement 3: Actualización de Posiciones de Avatares

**User Story:** Como usuario, quiero actualizar la posición de mi avatar en tiempo real, para que otros usuarios vean mi movimiento en el mapa virtual.

#### Acceptance Criteria

1. WHEN an updatePosition event is received with coordinates (x, y), THE Realtime_Service SHALL store the Position in Redis_Store with key pattern "position:{userId}"
2. THE Realtime_Service SHALL throttle updatePosition events to a maximum frequency of 50 milliseconds per user
3. WHEN a Position is updated, THE Virtual_Map_Gateway SHALL broadcast a positionUpdate event to all connected clients except the sender
4. THE Position record in Redis_Store SHALL expire after 300 seconds of inactivity
5. WHEN a user joins the map, THE Realtime_Service SHALL retrieve all active Position records from Redis_Store and send them to the joining user

### Requirement 4: Chat Temporal en Tiempo Real

**User Story:** Como usuario, quiero enviar mensajes de chat temporales en el mapa virtual, para comunicarme con otros usuarios cercanos.

#### Acceptance Criteria

1. WHEN a sendChat event is received with message content, THE Realtime_Service SHALL create a Chat_Message entity with userId, message, and timestamp
2. THE Realtime_Service SHALL store the Chat_Message in Redis_Store with key pattern "chat:{messageId}"
3. THE Virtual_Map_Gateway SHALL broadcast a chatMessage event to all connected clients with the Chat_Message data
4. THE Chat_Message record in Redis_Store SHALL expire after 60 seconds
5. THE Realtime_Service SHALL validate that message content is not empty and does not exceed 500 characters

### Requirement 5: Escalabilidad Horizontal con Redis

**User Story:** Como administrador del sistema, quiero que el microservicio soporte múltiples instancias, para escalar horizontalmente según la demanda.

#### Acceptance Criteria

1. THE Realtime_Service SHALL use Redis_Adapter from @socket.io/redis-adapter for Socket.IO
2. THE Realtime_Service SHALL configure Redis_Adapter with Redis connection from environment variables REDIS_HOST and REDIS_PORT
3. WHEN multiple instances of Realtime_Service are running, THE Redis_Adapter SHALL synchronize WebSocket events across all instances
4. THE Realtime_Service SHALL use ioredis client for direct Redis operations (storage and retrieval)

### Requirement 6: Integración con User Management

**User Story:** Como desarrollador del sistema, quiero obtener información de usuarios desde User_Management, para enriquecer los datos de presencia y chat.

#### Acceptance Criteria

1. WHEN a user joins the map, THE Realtime_Service SHALL make an HTTP GET request to User_Management at endpoint /users/{userId}
2. IF User_Management returns user data, THE Realtime_Service SHALL include name and email in the userJoined broadcast
3. IF User_Management returns an error or is unavailable, THE Realtime_Service SHALL use only the userId from JWT_Token
4. THE Realtime_Service SHALL configure the User_Management base URL from environment variable USER_MANAGEMENT_URL

### Requirement 7: Integración con Connection Management

**User Story:** Como usuario, quiero que el sistema notifique al microservicio de conexiones cuando interactúo con otros usuarios, para facilitar la creación de conexiones.

#### Acceptance Criteria

1. WHERE the frontend determines proximity between users, WHEN a connection request is initiated, THE Realtime_Service SHALL make an HTTP POST request to Connection_Management at endpoint /connections
2. THE Realtime_Service SHALL send requesterId and receiverId in the POST request body
3. THE Realtime_Service SHALL configure the Connection_Management base URL from environment variable CONNECTION_MANAGEMENT_URL
4. IF Connection_Management returns an error, THE Realtime_Service SHALL log the error but continue normal operation

### Requirement 8: Configuración de Entorno

**User Story:** Como administrador del sistema, quiero configurar el microservicio mediante variables de entorno, para adaptarlo a diferentes ambientes (desarrollo, producción).

#### Acceptance Criteria

1. THE Realtime_Service SHALL read PORT from environment variable with default value 3001
2. THE Realtime_Service SHALL read REDIS_HOST from environment variable with default value "localhost"
3. THE Realtime_Service SHALL read REDIS_PORT from environment variable with default value 6379
4. THE Realtime_Service SHALL read JWT_SECRET from environment variable for token validation
5. THE Realtime_Service SHALL read USER_MANAGEMENT_URL from environment variable
6. THE Realtime_Service SHALL read CONNECTION_MANAGEMENT_URL from environment variable
7. THE Realtime_Service SHALL provide an .env.example file with all required environment variables documented

### Requirement 9: Manejo de Errores WebSocket

**User Story:** Como desarrollador del sistema, quiero que los errores en eventos WebSocket sean manejados apropiadamente, para mantener la estabilidad del servicio.

#### Acceptance Criteria

1. WHEN an error occurs during event processing, THE Virtual_Map_Gateway SHALL emit an error event to the client with error details
2. IF a client sends malformed data, THE Virtual_Map_Gateway SHALL log the error and send an error event to the client
3. THE Realtime_Service SHALL continue operating normally after handling an error from a single client
4. WHEN Redis_Store is unavailable, THE Realtime_Service SHALL log the error and attempt to reconnect

### Requirement 10: Estructura de Proyecto Hexagonal

**User Story:** Como desarrollador del sistema, quiero que el código siga arquitectura hexagonal, para mantener consistencia con otros microservicios de Peerly.

#### Acceptance Criteria

1. THE Realtime_Service SHALL organize code in contexts/realtime/ with domain, application, and infrastructure layers
2. THE domain layer SHALL contain entities (AvatarPosition, ChatMessage, Presence) and ports (RealtimePort)
3. THE application layer SHALL contain services (RealtimeService) and use-cases
4. THE infrastructure layer SHALL contain adapters (in: Virtual_Map_Gateway, out: HTTP clients) and persistence (Redis)
5. THE Realtime_Service SHALL use dependency injection for all services and repositories

### Requirement 11: Namespace WebSocket

**User Story:** Como desarrollador del sistema, quiero que todas las conexiones WebSocket usen el namespace /map, para organizar la comunicación por contexto.

#### Acceptance Criteria

1. THE Virtual_Map_Gateway SHALL configure Socket.IO with namespace "/map"
2. THE Virtual_Map_Gateway SHALL enable CORS for WebSocket connections
3. WHEN a client connects, THE client SHALL specify the namespace "/map" in the connection URL
4. THE Virtual_Map_Gateway SHALL reject connections to namespaces other than "/map"

### Requirement 12: Eventos WebSocket Principales

**User Story:** Como desarrollador frontend, quiero una interfaz clara de eventos WebSocket, para implementar la comunicación en tiempo real.

#### Acceptance Criteria

1. THE Virtual_Map_Gateway SHALL handle the following incoming events: joinMap, updatePosition, sendChat
2. THE Virtual_Map_Gateway SHALL emit the following outgoing events: userJoined, userLeft, positionUpdate, chatMessage, error
3. THE joinMap event SHALL not require additional parameters beyond authentication
4. THE updatePosition event SHALL require parameters: x (number), y (number)
5. THE sendChat event SHALL require parameters: message (string)
6. THE userJoined event SHALL include: userId, name, email, timestamp
7. THE userLeft event SHALL include: userId, timestamp
8. THE positionUpdate event SHALL include: userId, x, y, timestamp
9. THE chatMessage event SHALL include: userId, name, message, timestamp
