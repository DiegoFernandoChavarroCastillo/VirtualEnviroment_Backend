# Implementation Plan: peerly-realtime-management

## Overview

Este plan de implementación desglosa el microservicio de tiempo real en tareas incrementales siguiendo arquitectura hexagonal. Cada tarea construye sobre las anteriores, comenzando con la infraestructura base, luego el dominio, la capa de aplicación, y finalmente los adaptadores de entrada/salida. Las pruebas se integran como sub-tareas opcionales para validar cada componente.

## Tasks

- [x] 1. Configurar infraestructura base del proyecto
  - Instalar dependencias faltantes (axios para HTTP clients)
  - Configurar variables de entorno en .env.example
  - Configurar JwtModule en RealtimeModule con JWT_SECRET
  - Configurar HttpModule en RealtimeModule para clientes HTTP
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [ ]* 1.1 Escribir tests unitarios para configuración de módulos
  - Verificar que JwtModule se configura correctamente con JWT_SECRET
  - Verificar que HttpModule está disponible para inyección
  - _Requirements: 8.4_

- [ ] 2. Implementar capa de persistencia con Redis
  - [x] 2.1 Crear RedisRepository en infrastructure/persistence/redis
    - Implementar constructor con configuración de ioredis (REDIS_HOST, REDIS_PORT)
    - Implementar setPresence(userId, socketId) sin TTL
    - Implementar getPresence(userId) retornando socketId o null
    - Implementar deletePresence(userId)
    - Implementar setPosition(userId, position, ttl=300) con serialización JSON
    - Implementar getPosition(userId) con deserialización JSON
    - Implementar getAllPositions() escaneando keys "position:*"
    - Implementar setChatMessage(messageId, message, ttl=60) con serialización JSON
    - Implementar getChatMessage(messageId) con deserialización JSON
    - _Requirements: 5.4, 3.1, 3.4, 4.2, 4.4_

  - [ ]* 2.2 Escribir tests de integración para RedisRepository
    - Verificar almacenamiento y recuperación de presencia
    - Verificar TTL de 300 segundos para posiciones
    - Verificar TTL de 60 segundos para mensajes de chat
    - Verificar getAllPositions retorna todas las posiciones activas
    - _Requirements: 3.4, 4.4_

- [ ] 3. Implementar adaptadores HTTP para servicios externos
  - [x] 3.1 Crear UserManagementClient en infrastructure/adapters/out
    - Implementar constructor con HttpService y USER_MANAGEMENT_URL
    - Implementar getUserById(userId) con GET /users/{userId}
    - Manejar errores retornando null si el servicio falla
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.2 Crear ConnectionManagementClient en infrastructure/adapters/out
    - Implementar constructor con HttpService y CONNECTION_MANAGEMENT_URL
    - Implementar createConnectionRequest(requesterId, receiverId) con POST /connections
    - Manejar errores solo registrando en logs sin interrumpir operación
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 3.3 Escribir tests unitarios para clientes HTTP
    - Mockear HttpService para UserManagementClient
    - Verificar manejo de errores retorna null en UserManagementClient
    - Mockear HttpService para ConnectionManagementClient
    - Verificar que errores en ConnectionManagementClient no interrumpen flujo
    - _Requirements: 6.3, 7.4_

- [ ] 4. Implementar casos de uso en application layer
  - [x] 4.1 Crear JoinMapUseCase en application/use-cases
    - Inyectar RedisRepository y UserManagementClient
    - Implementar execute(userId, socketId) que crea presencia en Redis
    - Obtener perfil de usuario desde UserManagementClient
    - Retornar UserJoinedEvent con userId, name, email, timestamp
    - _Requirements: 2.1, 2.5, 6.1, 6.2_

  - [x] 4.2 Crear UpdatePositionUseCase en application/use-cases
    - Inyectar RedisRepository
    - Implementar execute(userId, x, y) que crea AvatarPosition
    - Almacenar posición en Redis con TTL de 300 segundos
    - Retornar PositionUpdateEvent con userId, x, y, timestamp
    - _Requirements: 3.1, 3.4_

  - [x] 4.3 Crear SendChatUseCase en application/use-cases
    - Inyectar RedisRepository y UserManagementClient
    - Implementar execute(userId, message) con validación de mensaje
    - Validar mensaje no vacío y máximo 500 caracteres
    - Crear ChatMessage con messageId generado
    - Almacenar en Redis con TTL de 60 segundos
    - Obtener perfil de usuario y retornar ChatMessageEvent
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 6.1_

  - [ ]* 4.4 Escribir tests unitarios para use cases
    - Mockear RedisRepository y UserManagementClient
    - Verificar JoinMapUseCase crea presencia y enriquece con perfil
    - Verificar UpdatePositionUseCase almacena con TTL correcto
    - Verificar SendChatUseCase valida longitud de mensaje
    - Verificar SendChatUseCase rechaza mensajes vacíos
    - _Requirements: 2.1, 3.1, 4.5_

- [ ] 5. Checkpoint - Verificar capa de aplicación
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [ ] 6. Implementar RealtimeService en application layer
  - [x] 6.1 Crear RealtimeService en application/services
    - Inyectar RedisRepository, UserManagementClient, ConnectionManagementClient
    - Inyectar JoinMapUseCase, UpdatePositionUseCase, SendChatUseCase
    - Implementar handleUserJoin(userId, socketId) delegando a JoinMapUseCase
    - Implementar handleUserLeave(userId, socketId) eliminando presencia
    - Implementar updatePosition(userId, x, y) delegando a UpdatePositionUseCase
    - Implementar sendChatMessage(userId, message) delegando a SendChatUseCase
    - Implementar getAllActivePositions() delegando a RedisRepository
    - _Requirements: 2.1, 2.2, 3.1, 3.5, 4.1_

  - [ ]* 6.2 Escribir tests unitarios para RealtimeService
    - Mockear todos los use cases y repositorios
    - Verificar handleUserJoin delega correctamente
    - Verificar handleUserLeave elimina presencia
    - Verificar getAllActivePositions retorna posiciones activas
    - _Requirements: 2.2, 3.5_

- [ ] 7. Implementar JwtAuthGuard para WebSocket
  - [x] 7.1 Crear JwtAuthGuard en common/guards
    - Inyectar JwtService
    - Implementar canActivate(context) extrayendo Socket del contexto
    - Implementar extractToken(client) intentando auth.token primero
    - Si auth.token no existe, intentar headers.authorization
    - Remover prefijo "Bearer " si existe
    - Verificar token con jwtService.verifyAsync(token)
    - Almacenar payload en client.data.user
    - Lanzar WsException si token inválido o faltante
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 7.2 Escribir property test para autenticación
    - **Property 1: Authentication validates tokens and extracts user data**
    - **Validates: Requirements 1.1, 1.3**
    - Generar tokens JWT válidos e inválidos aleatoriamente
    - Verificar que tokens válidos son aceptados y datos extraídos
    - Verificar que tokens inválidos son rechazados
    - Probar extracción desde auth.token y headers.authorization
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 8. Implementar VirtualMapGateway con Socket.IO
  - [x] 8.1 Crear VirtualMapGateway en infrastructure/adapters/in
    - Configurar @WebSocketGateway con namespace "/map" y CORS habilitado
    - Inyectar RealtimeService
    - Implementar OnGatewayConnection y OnGatewayDisconnect
    - Declarar @WebSocketServer() server: Server
    - Implementar afterInit(server) configurando Redis Adapter con pubClient y subClient
    - _Requirements: 5.1, 5.2, 5.3, 11.1, 11.2, 11.3_

  - [x] 8.2 Implementar lifecycle hooks en VirtualMapGateway
    - Implementar handleConnection(client) aplicando JwtAuthGuard
    - Implementar handleDisconnect(client) llamando handleUserLeave
    - Emitir evento "userLeft" a todos los clientes en disconnect
    - _Requirements: 2.2, 2.4_

  - [x] 8.3 Implementar event handlers en VirtualMapGateway
    - Implementar @SubscribeMessage('joinMap') con @UseGuards(JwtAuthGuard)
    - En joinMap: llamar handleUserJoin, emitir "userJoined" a todos los clientes
    - Enviar todas las posiciones activas al cliente que se une
    - Implementar @SubscribeMessage('updatePosition') con @UseGuards(JwtAuthGuard)
    - En updatePosition: validar UpdatePositionDto, llamar updatePosition
    - Aplicar throttling de 50ms con @Throttle(1, 0.05)
    - Emitir "positionUpdate" a todos excepto el emisor con broadcast.except()
    - Implementar @SubscribeMessage('sendChat') con @UseGuards(JwtAuthGuard)
    - En sendChat: validar SendChatDto, llamar sendChatMessage
    - Emitir "chatMessage" a todos los clientes
    - Implementar manejo de errores emitiendo evento "error" al cliente
    - _Requirements: 2.3, 3.2, 3.3, 3.5, 4.3, 9.1, 9.2, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 8.4 Escribir property test para presencia round-trip
    - **Property 2: Presence round-trip preserves connection state**
    - **Validates: Requirements 2.1, 2.2**
    - Generar conexiones y desconexiones aleatorias de usuarios
    - Verificar que presencia se crea en conexión
    - Verificar que presencia se elimina en desconexión
    - _Requirements: 2.1, 2.2_

  - [ ]* 8.5 Escribir property test para broadcast de join
    - **Property 3: User join broadcasts to all clients with complete payload**
    - **Validates: Requirements 2.3, 12.6**
    - Generar joins aleatorios con diferentes cantidades de clientes conectados
    - Verificar que todos los clientes reciben evento "userJoined"
    - Verificar payload contiene userId, name, email, timestamp
    - _Requirements: 2.3, 12.6_

  - [ ]* 8.6 Escribir property test para broadcast de leave
    - **Property 4: User leave broadcasts to all clients with correct payload**
    - **Validates: Requirements 2.4, 12.7**
    - Generar disconnects aleatorios
    - Verificar que todos los clientes restantes reciben "userLeft"
    - Verificar payload contiene userId y timestamp
    - _Requirements: 2.4, 12.7_

  - [ ]* 8.7 Escribir property test para actualización de posición
    - **Property 5: Position update stores and broadcasts with complete payload**
    - **Validates: Requirements 3.1, 3.3, 12.8**
    - Generar coordenadas aleatorias (x, y)
    - Verificar que posición se almacena en Redis con key "position:{userId}"
    - Verificar que todos los clientes excepto emisor reciben "positionUpdate"
    - Verificar payload contiene userId, x, y, timestamp
    - _Requirements: 3.1, 3.3, 12.8_

  - [ ]* 8.8 Escribir property test para throttling de posiciones
    - **Property 6: Position updates are throttled to maximum frequency**
    - **Validates: Requirements 3.2**
    - Generar múltiples actualizaciones rápidas de posición
    - Verificar que se procesa máximo 1 actualización por 50ms por usuario
    - Verificar que actualizaciones intermedias se descartan
    - _Requirements: 3.2_

  - [ ]* 8.9 Escribir property test para posiciones iniciales
    - **Property 7: Joining user receives all active positions**
    - **Validates: Requirements 3.5**
    - Generar N posiciones activas aleatorias en Redis
    - Simular usuario uniéndose al mapa
    - Verificar que usuario recibe todas las N posiciones
    - _Requirements: 3.5_

  - [ ]* 8.10 Escribir property test para broadcast de chat
    - **Property 8: Chat message is stored and broadcast with complete payload**
    - **Validates: Requirements 4.1, 4.2, 4.3, 12.9**
    - Generar mensajes válidos aleatorios
    - Verificar que mensaje se almacena en Redis con key "chat:{messageId}"
    - Verificar TTL de 60 segundos
    - Verificar que todos los clientes reciben "chatMessage"
    - Verificar payload contiene userId, name, message, timestamp
    - _Requirements: 4.1, 4.2, 4.3, 12.9_

  - [ ]* 8.11 Escribir property test para validación de mensajes
    - **Property 9: Message validation rejects invalid messages**
    - **Validates: Requirements 4.5**
    - Generar mensajes de longitud aleatoria (0-600 caracteres)
    - Verificar que mensajes vacíos son rechazados con evento "error"
    - Verificar que mensajes >500 caracteres son rechazados con evento "error"
    - Verificar que mensajes válidos son aceptados
    - _Requirements: 4.5_

  - [ ]* 8.12 Escribir property test para manejo de errores
    - **Property 10: Error handling emits error events for any error condition**
    - **Validates: Requirements 9.1, 9.2**
    - Generar condiciones de error aleatorias (datos malformados, validaciones fallidas)
    - Verificar que cada error emite evento "error" al cliente afectado
    - Verificar que servicio no se cae después de error
    - _Requirements: 9.1, 9.2_

  - [ ]* 8.13 Escribir property test para resiliencia del servicio
    - **Property 11: Service resilience after single client error**
    - **Validates: Requirements 9.3**
    - Generar error en un cliente específico
    - Verificar que otros clientes continúan enviando y recibiendo eventos normalmente
    - Verificar aislamiento de errores por cliente
    - _Requirements: 9.3_

- [ ] 9. Checkpoint - Verificar gateway y eventos WebSocket
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [ ] 10. Configurar módulos y wiring final
  - [x] 10.1 Actualizar RealtimeModule con todos los providers
    - Registrar JwtModule con JWT_SECRET
    - Registrar HttpModule
    - Agregar VirtualMapGateway a providers
    - Agregar RealtimeService a providers
    - Agregar todos los use cases a providers
    - Agregar RedisRepository a providers
    - Agregar UserManagementClient a providers
    - Agregar ConnectionManagementClient a providers
    - Agregar JwtAuthGuard a providers
    - _Requirements: 10.5_

  - [x] 10.2 Actualizar main.ts con configuración del servidor
    - Configurar puerto desde process.env.PORT con default 3001
    - Habilitar CORS si es necesario
    - _Requirements: 8.1_

  - [ ]* 10.3 Escribir tests de integración E2E
    - Test de flujo completo de conexión con JWT
    - Test de flujo de join con broadcast
    - Test de flujo de actualización de posición con throttling
    - Test de flujo de chat con broadcast
    - Test de flujo de desconexión con cleanup
    - _Requirements: 2.3, 3.2, 4.3, 2.4_

- [ ] 11. Implementar health check y documentación
  - [x] 11.1 Crear endpoint de health check
    - Crear HealthController con GET /health
    - Verificar conexión a Redis
    - Retornar 200 OK si saludable, 503 si no
    - _Requirements: 9.4_

  - [x] 11.2 Actualizar .env.example con todas las variables
    - Documentar PORT, REDIS_HOST, REDIS_PORT
    - Documentar JWT_SECRET
    - Documentar USER_MANAGEMENT_URL, CONNECTION_MANAGEMENT_URL
    - Incluir valores de ejemplo y descripciones
    - _Requirements: 8.7_

  - [ ] 11.3 Actualizar README.md con instrucciones
    - Documentar arquitectura hexagonal
    - Documentar eventos WebSocket (entrada y salida)
    - Documentar variables de entorno requeridas
    - Incluir ejemplos de uso del cliente WebSocket
    - _Requirements: 12.1, 12.2_

- [ ] 12. Checkpoint final - Verificar implementación completa
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los property tests validan las 11 propiedades universales de correctitud
- Los unit tests validan ejemplos específicos y casos edge
- La implementación sigue arquitectura hexagonal estricta
- El throttling de 50ms para updatePosition es crítico para rendimiento
- Redis Adapter permite escalabilidad horizontal con múltiples instancias
