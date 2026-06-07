export class Presence {
  constructor(
    public readonly userId: string,
    public readonly socketId: string,
    public readonly connectedAt: Date = new Date(),
  ) {}

  toJSON(): object {
    return {
      userId: this.userId,
      socketId: this.socketId,
      connectedAt: this.connectedAt.toISOString(),
    };
  }

  static fromJSON(data: any): Presence {
    return new Presence(
      data.userId,
      data.socketId,
      new Date(data.connectedAt),
    );
  }
}
