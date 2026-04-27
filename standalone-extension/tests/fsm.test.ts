// FSM tests

import { describe, it, expect } from 'vitest';
import { RuntimeFSM } from '../src/runtime/fsm';

describe('RuntimeFSM', () => {
  const fsm = new RuntimeFSM();

  describe('valid transitions', () => {
    it('should allow START_REQUESTED from IDLE', () => {
      expect(fsm.canTransition('IDLE', 'START_REQUESTED')).toBe(true);
      expect(fsm.transition('IDLE', 'START_REQUESTED')).toBe('STARTING');
    });

    it('should allow START_REQUESTED from STOPPED', () => {
      expect(fsm.canTransition('STOPPED', 'START_REQUESTED')).toBe(true);
      expect(fsm.transition('STOPPED', 'START_REQUESTED')).toBe('STARTING');
    });

    it('should allow START_CONFIRMED from STARTING', () => {
      expect(fsm.canTransition('STARTING', 'START_CONFIRMED')).toBe(true);
      expect(fsm.transition('STARTING', 'START_CONFIRMED')).toBe('RUNNING');
    });

    it('should allow STOP_REQUESTED from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'STOP_REQUESTED')).toBe(true);
      expect(fsm.transition('RUNNING', 'STOP_REQUESTED')).toBe('STOPPING');
    });

    it('should allow STOP_REQUESTED from PAUSED_BY_USER', () => {
      expect(fsm.canTransition('PAUSED_BY_USER', 'STOP_REQUESTED')).toBe(true);
      expect(fsm.transition('PAUSED_BY_USER', 'STOP_REQUESTED')).toBe('STOPPING');
    });

    it('should allow STOP_CONFIRMED from STOPPING', () => {
      expect(fsm.canTransition('STOPPING', 'STOP_CONFIRMED')).toBe(true);
      expect(fsm.transition('STOPPING', 'STOP_CONFIRMED')).toBe('STOPPED');
    });

    it('should allow PAUSE_BY_USER from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'PAUSE_BY_USER')).toBe(true);
      expect(fsm.transition('RUNNING', 'PAUSE_BY_USER')).toBe('PAUSED_BY_USER');
    });

    it('should allow RESUME_REQUESTED from PAUSED_BY_USER', () => {
      expect(fsm.canTransition('PAUSED_BY_USER', 'RESUME_REQUESTED')).toBe(true);
      expect(fsm.transition('PAUSED_BY_USER', 'RESUME_REQUESTED')).toBe('RUNNING');
    });

    it('should allow MANUAL_ACTION_REQUIRED from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'MANUAL_ACTION_REQUIRED')).toBe(true);
      expect(fsm.transition('RUNNING', 'MANUAL_ACTION_REQUIRED')).toBe('PAUSED_MANUAL_ACTION');
    });

    it('should allow NO_MORE_VACANCIES from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'NO_MORE_VACANCIES')).toBe(true);
      expect(fsm.transition('RUNNING', 'NO_MORE_VACANCIES')).toBe('PAUSED_NO_VACANCIES');
    });

    it('should allow FAILURE from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'FAILURE')).toBe(true);
      expect(fsm.transition('RUNNING', 'FAILURE')).toBe('ERROR');
    });

    it('should allow RESET from ERROR', () => {
      expect(fsm.canTransition('ERROR', 'RESET')).toBe(true);
      expect(fsm.transition('ERROR', 'RESET')).toBe('IDLE');
    });

    it('should allow RESET from STOPPED', () => {
      expect(fsm.canTransition('STOPPED', 'RESET')).toBe(true);
      expect(fsm.transition('STOPPED', 'RESET')).toBe('IDLE');
    });
  });

  describe('invalid transitions', () => {
    it('should block START_REQUESTED from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'START_REQUESTED')).toBe(false);
      expect(() => fsm.transition('RUNNING', 'START_REQUESTED')).toThrow();
    });

    it('should block STOP_REQUESTED from IDLE', () => {
      expect(fsm.canTransition('IDLE', 'STOP_REQUESTED')).toBe(false);
      expect(() => fsm.transition('IDLE', 'STOP_REQUESTED')).toThrow();
    });

    it('should block PAUSE_BY_USER from IDLE', () => {
      expect(fsm.canTransition('IDLE', 'PAUSE_BY_USER')).toBe(false);
      expect(() => fsm.transition('IDLE', 'PAUSE_BY_USER')).toThrow();
    });

    it('should block RESUME_REQUESTED from RUNNING', () => {
      expect(fsm.canTransition('RUNNING', 'RESUME_REQUESTED')).toBe(false);
      expect(() => fsm.transition('RUNNING', 'RESUME_REQUESTED')).toThrow();
    });
  });

  describe('getValidEvents', () => {
    it('should return valid events for IDLE', () => {
      const events = fsm.getValidEvents('IDLE');
      expect(events).toContain('START_REQUESTED');
      expect(events).not.toContain('STOP_REQUESTED');
    });

    it('should return valid events for RUNNING', () => {
      const events = fsm.getValidEvents('RUNNING');
      expect(events).toContain('STOP_REQUESTED');
      expect(events).toContain('PAUSE_BY_USER');
      expect(events).toContain('MANUAL_ACTION_REQUIRED');
      expect(events).toContain('NO_MORE_VACANCIES');
      expect(events).toContain('FAILURE');
      expect(events).not.toContain('START_REQUESTED');
    });
  });
});
