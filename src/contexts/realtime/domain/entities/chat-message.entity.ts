export class ChatMessage {
  public readonly id: string;
  public readonly timestamp: Date;

  constructor(
    public readonly userId: string,
    public readonly message: string,
  ) {
    this.id = `${userId}-${Date.now()}`;
    this.timestamp = new Date();
  }

  toJSON(): object {
    return {
      id: this.id,
      userId: this.userId,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
    };
  }

  static fromJSON(data: any): ChatMessage {
    const chatMessage = new ChatMessage(data.userId, data.message);
    (chatMessage as any).id = data.id;
    (chatMessage as any).timestamp = new Date(data.timestamp);
    return chatMessage;
  }
}
