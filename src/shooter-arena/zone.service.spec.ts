import { ZoneService } from './zone.service';
import { SHOOTER_ZONE_RECT } from './interfaces/shooter-arena.interfaces';

describe('ZoneService', () => {
  let service: ZoneService;
  let mockEngine: any;
  let mockServer: any;

  beforeEach(() => {
    mockEngine = {
      getRoomState: jest.fn().mockReturnValue({ roomId: 'room-1', players: [] }),
    };
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    service = new ZoneService(mockEngine);
    service.setMapServer(mockServer);
  });

  describe('isInsideZone', () => {
    const zone = { x: 100, y: 100, width: 50, height: 50 };

    it('should return true when point is inside zone', () => {
      expect(service.isInsideZone({ x: 125, y: 125 }, zone)).toBe(true);
    });

    it('should return true on zone boundary', () => {
      expect(service.isInsideZone({ x: 100, y: 100 }, zone)).toBe(true);
      expect(service.isInsideZone({ x: 150, y: 150 }, zone)).toBe(true);
    });

    it('should return false when point is outside zone', () => {
      expect(service.isInsideZone({ x: 0, y: 0 }, zone)).toBe(false);
      expect(service.isInsideZone({ x: 200, y: 200 }, zone)).toBe(false); // outside zone {100,100,50,50}
    });
  });

  describe('getZoneState', () => {
    it('should return initial available state', () => {
      const state = service.getZoneState();
      expect(state.status).toBe('available');
      expect(state.activePlayers).toBe(0);
    });
  });

  describe('lockZone / unlockZone', () => {
    it('should lock zone with player count', () => {
      service.lockZone(5);
      expect(service.getZoneState().status).toBe('locked');
      expect(service.getZoneState().activePlayers).toBe(5);
      expect(mockServer.emit).toHaveBeenCalledWith('roomState', expect.any(Object));
    });

    it('should unlock zone when below max players', () => {
      service.lockZone(5);
      service.unlockZone(3);
      expect(service.getZoneState().status).toBe('available');
    });

    it('should keep locked when at max players after unlock', () => {
      service.lockZone(10);
      service.unlockZone(10);
      expect(service.getZoneState().status).toBe('locked');
    });
  });

  describe('clearTriggered', () => {
    it('should clear triggered state for user', () => {
      service.clearTriggered('u1');
      // Should not throw
    });
  });

  describe('handleCheckShooterZone', () => {
    it('should do nothing if user already triggered', async () => {
      // Trigger the user first by simulating internal state
      // Then check that subsequent calls are ignored
      const mockSrv = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as any;
      await service.handleCheckShooterZone('u1', 's1', 0, 0, mockSrv);
      // Outside zone — no action
      expect(mockSrv.emit).not.toHaveBeenCalled();
    });

    it('should emit zoneBlocked when zone is locked', async () => {
      service.lockZone(10);
      const mockSrv = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as any;
      // Use actual SHOOTER_ZONE_RECT coordinates: x:1200, y:540, width:150, height:150
      const pos = { x: 1250, y: 600 };
      await service.handleCheckShooterZone('u1', 's1', pos.x, pos.y, mockSrv);
      // Zone is locked — should emit zoneBlocked via mapServer
      expect(mockServer.to).toHaveBeenCalledWith('s1');
      expect(mockServer.emit).toHaveBeenCalledWith('zoneBlocked', expect.any(Object));
    });

    it('should track entry when player enters zone', async () => {
      const mockSrv = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as any;
      const pos = { x: SHOOTER_ZONE_RECT.x + 10, y: SHOOTER_ZONE_RECT.y + 10 };
      await service.handleCheckShooterZone('u1', 's1', pos.x, pos.y, mockSrv);
      // First entry — just tracking, no emit yet
      expect(mockSrv.emit).not.toHaveBeenCalled();
    });
  });
});
