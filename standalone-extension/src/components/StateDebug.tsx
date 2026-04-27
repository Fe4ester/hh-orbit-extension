import React, { useState } from 'react';
import { AppState } from '../state/types';

interface StateDebugProps {
  state: AppState;
}

export const StateDebug: React.FC<StateDebugProps> = ({ state }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="btn btn-secondary"
        onClick={() => setExpanded(!expanded)}
        style={{ marginBottom: '8px' }}
      >
        {expanded ? 'Скрыть' : 'Показать'} состояние
      </button>

      {expanded && (
        <div className="debug-state">
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
