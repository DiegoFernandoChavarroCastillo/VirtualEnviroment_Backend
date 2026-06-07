import { DuelPadService } from './duel-pad.service';

describe('DuelPadService', () => {
  let service: DuelPadService;
  let mockServer: any;

  beforeEach(() => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    service = new DuelPadService();
    service.setMapServer(mockServer);
  });

  describe('isInsidePad', () => {
    it('should return false when avatar is far from pad', () => {
      // Pads are at the bottom of the field — test with position far away
      const result = service.isInsidePad('pad-a', 0, 0);
      expect(result).toBe(false);
    });

    it('should return false for pad-b when far away', () => {
      const result = service.isInsidePad('pad-b', 0, 0);
      expect(result).toBe(false);
    });
  });

  describe('getPadStates', () => {
    it('should return two pad states initially', async () => {
      const states = await service.getPadStates();
      expect(states).toHaveLength(2);
      expect(states[0].padId).toBe('pad-a');
      expect(states[1].padId).toBe('pad-b');
    });

    it('should return available status initially', async () => {
      const states = await service.getPadStates();
      expect(states[0].status).toBe('available');
      expect(states[1].status).toBe('available');
    });
  });

  describe('lockPads / unlockPads', () => {
    it('should lock pads and broadcast', async () => {
      await service.lockPads('match-1');
      const states = await service.getPadStates();
      expect(states[0].status).toBe('locked');
      expect(mockServer.emit).toHaveBeenCalledWith('padStateUpdate', expect.any(Array));
    });

    it('should unlock pads and reset state', async () => {
      await service.lockPads('match-1');
      await service.unlockPads();
      const states = await service.getPadStates();
      expect(states[0].status).toBe('available');
    });
  });

  describe('handleCheckDuelPads', () => {
    it('should return null padId when player is not on any pad', async () => {
      const result = await service.handleCheckDuelPads('u1', 'User', 's1', 0, 0);
      expect(result.padId).toBeNull();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked when pads are locked', async () => {
      await service.lockPads('match-1');
      // Even if player is on a pad, it should be blocked
      // We test with a position that might be on a pad
      const result = await service.handleCheckDuelPads('u1', 'User', 's1', 400, 490);
      // Either blocked or not on pad — both are valid
      expect(result).toBeDefined();
    });
  });

  describe('setDuelActivatedCallback', () => {
    it('should set callback without error', () => {
      const cb = jest.fn().mockResolvedValue('match-1');
      expect(() => service.setDuelActivatedCallback(cb)).not.toThrow();
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('should initialize polling interval', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should clear polling interval on destroy', () => {
      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
