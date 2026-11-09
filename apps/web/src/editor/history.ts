import { useCallback, useMemo, useReducer } from 'react';
import { LIMITS, type DesignDoc } from '@poster/core';

type HistoryState = {
  past: DesignDoc[];
  present: DesignDoc;
  future: DesignDoc[];
  last: { key: string; at: number } | null;
};

export type UpdateOptions = {
  /** Set to false for live drag updates; call `commit` when the gesture ends. */
  history?: boolean;
  /** Consecutive updates with the same key within the window share one undo step. */
  coalesceKey?: string;
};

type Action =
  | { type: 'update'; updater: (doc: DesignDoc) => DesignDoc; options: UpdateOptions; at: number }
  | { type: 'commit'; before: DesignDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; doc: DesignDoc }
  | { type: 'reset'; doc: DesignDoc };

const COALESCE_WINDOW_MS = 900;

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'update': {
      const next = action.updater(state.present);
      if (next === state.present) return state;

      if (action.options.history === false) {
        return { ...state, present: next, future: [], last: null };
      }

      const key = action.options.coalesceKey;
      const coalesce =
        key !== undefined &&
        state.last?.key === key &&
        action.at - state.last.at < COALESCE_WINDOW_MS;

      return {
        past: coalesce
          ? state.past
          : [...state.past, state.present].slice(-LIMITS.history.maxSteps),
        present: next,
        future: [],
        last: key === undefined ? null : { key, at: action.at },
      };
    }
    case 'commit': {
      if (state.present === action.before) return state;
      const past =
        state.past.at(-1) === action.before
          ? state.past
          : [...state.past, action.before].slice(-LIMITS.history.maxSteps);
      return { ...state, past, future: [], last: null };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, LIMITS.history.maxSteps),
        last: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present].slice(-LIMITS.history.maxSteps),
        present: next,
        future: state.future.slice(1),
        last: null,
      };
    }
    case 'replace':
      return {
        past: [...state.past, state.present].slice(-LIMITS.history.maxSteps),
        present: action.doc,
        future: [],
        last: null,
      };
    case 'reset':
      return { past: [], present: action.doc, future: [], last: null };
  }
}

export type DocHistory = {
  doc: DesignDoc;
  canUndo: boolean;
  canRedo: boolean;
  update: (updater: (doc: DesignDoc) => DesignDoc, options?: UpdateOptions) => void;
  commit: (before: DesignDoc) => void;
  undo: () => void;
  redo: () => void;
  replace: (doc: DesignDoc) => void;
  reset: (doc: DesignDoc) => void;
};

export function useDocHistory(initial: DesignDoc): DocHistory {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
    last: null,
  });

  const update = useCallback(
    (updater: (doc: DesignDoc) => DesignDoc, options: UpdateOptions = {}) => {
      dispatch({ type: 'update', updater, options, at: Date.now() });
    },
    [],
  );

  const commit = useCallback((before: DesignDoc) => {
    dispatch({ type: 'commit', before });
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const replace = useCallback((doc: DesignDoc) => dispatch({ type: 'replace', doc }), []);
  const reset = useCallback((doc: DesignDoc) => dispatch({ type: 'reset', doc }), []);

  return useMemo(
    () => ({
      doc: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      update,
      commit,
      undo,
      redo,
      replace,
      reset,
    }),
    [
      state.present,
      state.past.length,
      state.future.length,
      update,
      commit,
      undo,
      redo,
      replace,
      reset,
    ],
  );
}
