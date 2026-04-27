// Runtime FSM

import { RuntimeState, RuntimeEvent } from '../state/types';

type Transition = {
  from: RuntimeState[];
  to: RuntimeState;
};

const TRANSITIONS: Record<RuntimeEvent, Transition> = {
  START_REQUESTED: {
    from: ['IDLE', 'STOPPED'],
    to: 'STARTING',
  },
  START_CONFIRMED: {
    from: ['STARTING'],
    to: 'RUNNING',
  },
  STOP_REQUESTED: {
    from: ['RUNNING', 'PAUSED_BY_USER', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES'],
    to: 'STOPPING',
  },
  STOP_CONFIRMED: {
    from: ['STOPPING'],
    to: 'STOPPED',
  },
  PAUSE_BY_USER: {
    from: ['RUNNING'],
    to: 'PAUSED_BY_USER',
  },
  RESUME_REQUESTED: {
    from: ['PAUSED_BY_USER', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES'],
    to: 'RUNNING',
  },
  MANUAL_ACTION_REQUIRED: {
    from: ['RUNNING'],
    to: 'PAUSED_MANUAL_ACTION',
  },
  NO_MORE_VACANCIES: {
    from: ['RUNNING'],
    to: 'PAUSED_NO_VACANCIES',
  },
  FAILURE: {
    from: ['STARTING', 'RUNNING', 'STOPPING'],
    to: 'ERROR',
  },
  RESET: {
    from: ['ERROR', 'STOPPED'],
    to: 'IDLE',
  },
};

export class RuntimeFSM {
  canTransition(currentState: RuntimeState, event: RuntimeEvent): boolean {
    const transition = TRANSITIONS[event];
    if (!transition) {
      return false;
    }

    return transition.from.includes(currentState);
  }

  transition(currentState: RuntimeState, event: RuntimeEvent): RuntimeState {
    if (!this.canTransition(currentState, event)) {
      throw new Error(
        `Invalid transition: ${event} from ${currentState}. Valid states: ${TRANSITIONS[event]?.from.join(', ') || 'none'}`
      );
    }

    return TRANSITIONS[event].to;
  }

  getValidEvents(currentState: RuntimeState): RuntimeEvent[] {
    return (Object.keys(TRANSITIONS) as RuntimeEvent[]).filter((event) =>
      this.canTransition(currentState, event)
    );
  }
}
