import { describe, it, expect } from 'vitest';
import {
  setLiveModeTargetSearch,
  markSearchNavigating,
  markSearchSynced,
  markSearchOutOfSync,
  markSearchError,
  activateLiveMode,
} from '../src/state/actions';

describe('search sync actions', () => {
  it('setLiveModeTargetSearch sets target URL and profile ID', () => {
    const initial = activateLiveMode();
    const result = setLiveModeTargetSearch(initial, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');

    expect(result.targetSearchUrl).toBe('https://hh.ru/search/vacancy?text=typescript');
    expect(result.lastAppliedProfileId).toBe('profile-1');
    expect(result.searchSyncStatus).toBe('idle');
  });

  it('markSearchNavigating sets navigating status and current URL', () => {
    const initial = activateLiveMode();
    const withTarget = setLiveModeTargetSearch(initial, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    const result = markSearchNavigating(withTarget, 'https://hh.ru/search/vacancy?text=typescript');

    expect(result.searchSyncStatus).toBe('navigating');
    expect(result.currentUrl).toBe('https://hh.ru/search/vacancy?text=typescript');
  });

  it('markSearchSynced sets synced status and updates last applied URL', () => {
    const initial = activateLiveMode();
    const withTarget = setLiveModeTargetSearch(initial, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    const navigating = markSearchNavigating(withTarget, 'https://hh.ru/search/vacancy?text=typescript');
    const result = markSearchSynced(navigating, 'https://hh.ru/search/vacancy?text=typescript', 'profile-1');

    expect(result.searchSyncStatus).toBe('synced');
    expect(result.lastAppliedSearchUrl).toBe('https://hh.ru/search/vacancy?text=typescript');
    expect(result.lastAppliedProfileId).toBe('profile-1');
  });

  it('markSearchOutOfSync sets out_of_sync status', () => {
    const initial = activateLiveMode();
    const withTarget = setLiveModeTargetSearch(initial, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    const synced = markSearchSynced(withTarget, 'https://hh.ru/search/vacancy?text=typescript', 'profile-1');
    const result = markSearchOutOfSync(synced);

    expect(result.searchSyncStatus).toBe('out_of_sync');
  });

  it('markSearchError sets error status', () => {
    const initial = activateLiveMode();
    const result = markSearchError(initial);

    expect(result.searchSyncStatus).toBe('error');
  });

  it('search sync workflow: idle -> navigating -> synced', () => {
    let state = activateLiveMode();
    expect(state.searchSyncStatus).toBe('idle');

    state = setLiveModeTargetSearch(state, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    expect(state.searchSyncStatus).toBe('idle');

    state = markSearchNavigating(state, 'https://hh.ru/search/vacancy?text=typescript');
    expect(state.searchSyncStatus).toBe('navigating');

    state = markSearchSynced(state, 'https://hh.ru/search/vacancy?text=typescript', 'profile-1');
    expect(state.searchSyncStatus).toBe('synced');
  });

  it('search sync workflow: synced -> out_of_sync when URL diverges', () => {
    let state = activateLiveMode();
    state = setLiveModeTargetSearch(state, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    state = markSearchNavigating(state, 'https://hh.ru/search/vacancy?text=typescript');
    state = markSearchSynced(state, 'https://hh.ru/search/vacancy?text=typescript', 'profile-1');

    expect(state.searchSyncStatus).toBe('synced');

    state = markSearchOutOfSync(state);
    expect(state.searchSyncStatus).toBe('out_of_sync');
  });

  it('active profile switch updates target URL', () => {
    let state = activateLiveMode();

    state = setLiveModeTargetSearch(state, 'profile-1', 'https://hh.ru/search/vacancy?text=typescript');
    expect(state.targetSearchUrl).toBe('https://hh.ru/search/vacancy?text=typescript');
    expect(state.lastAppliedProfileId).toBe('profile-1');

    state = setLiveModeTargetSearch(state, 'profile-2', 'https://hh.ru/search/vacancy?text=react');
    expect(state.targetSearchUrl).toBe('https://hh.ru/search/vacancy?text=react');
    expect(state.lastAppliedProfileId).toBe('profile-2');
  });
});
