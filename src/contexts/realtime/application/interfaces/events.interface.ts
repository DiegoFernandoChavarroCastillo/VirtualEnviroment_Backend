export interface UserJoinedEvent {
  userId: string;
  name: string;
  email: string;
  x: number;
  y: number;
  timestamp: string;
}

export interface UserLeftEvent {
  userId: string;
  timestamp: string;
}

export interface PositionUpdateEvent {
  userId: string;
  x: number;
  y: number;
  timestamp: string;
}

export interface ChatMessageEvent {
  userId: string;
  name: string;
  message: string;
  timestamp: string;
}
