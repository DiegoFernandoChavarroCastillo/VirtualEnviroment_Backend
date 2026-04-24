export class AvatarPosition {
  constructor(
    public readonly userId: string,
    public readonly name: string,
    public readonly x: number,
    public readonly y: number,
    public readonly timestamp: Date = new Date(),
  ) {}

  toJSON(): object {
    return {
      userId: this.userId,
      name: this.name,
      x: this.x,
      y: this.y,
      timestamp: this.timestamp.toISOString(),
    };
  }

  static fromJSON(data: any): AvatarPosition {
    return new AvatarPosition(
      data.userId,
      data.name || 'Unknown',
      data.x,
      data.y,
      new Date(data.timestamp),
    );
  }
}
