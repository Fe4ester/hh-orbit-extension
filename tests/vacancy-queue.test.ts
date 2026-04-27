import { describe, it, expect } from 'vitest';
import {
  materializeVacanciesFromSearch,
  clearVacancyQueue,
  markVacancyQueued,
  markVacancyProcessed,
  markVacancySkipped,
} from '../src/state/actions';
import { VacancyQueueItem } from '../src/state/types';
import { ParsedVacancyCard } from '../src/live/searchResultsParser';

describe('vacancy queue actions', () => {
  const createCard = (id: string, title: string): ParsedVacancyCard => ({
    vacancyId: id,
    url: `https://hh.ru/vacancy/${id}`,
    title,
    company: 'Test Company',
  });

  it('materializeVacanciesFromSearch creates queue items', () => {
    const cards: ParsedVacancyCard[] = [
      createCard('100001', 'Frontend Developer'),
      createCard('100002', 'Backend Developer'),
    ];

    const queue = materializeVacanciesFromSearch([], cards, 'profile-1');

    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      vacancyId: '100001',
      title: 'Frontend Developer',
      profileId: 'profile-1',
      status: 'discovered',
      source: 'search_dom',
    });
    expect(queue[0].discoveredAt).toBeDefined();
  });

  it('dedupes by vacancyId', () => {
    const existingQueue: VacancyQueueItem[] = [
      {
        vacancyId: '100001',
        url: 'https://hh.ru/vacancy/100001',
        title: 'Existing',
        source: 'search_dom',
        discoveredAt: Date.now() - 1000,
        profileId: 'profile-1',
        status: 'discovered',
      },
    ];

    const cards: ParsedVacancyCard[] = [
      createCard('100001', 'Duplicate'),
      createCard('100002', 'New'),
    ];

    const queue = materializeVacanciesFromSearch(existingQueue, cards, 'profile-1');

    expect(queue).toHaveLength(2);
    expect(queue[0].title).toBe('Existing');
    expect(queue[1].title).toBe('New');
  });

  it('dedupes by url when no vacancyId', () => {
    const existingQueue: VacancyQueueItem[] = [
      {
        vacancyId: null,
        url: 'https://hh.ru/vacancy/special',
        title: 'Existing',
        source: 'search_dom',
        discoveredAt: Date.now() - 1000,
        profileId: 'profile-1',
        status: 'discovered',
      },
    ];

    const cards: ParsedVacancyCard[] = [
      {
        vacancyId: null,
        url: 'https://hh.ru/vacancy/special',
        title: 'Duplicate',
      },
      {
        vacancyId: null,
        url: 'https://hh.ru/vacancy/new',
        title: 'New',
      },
    ];

    const queue = materializeVacanciesFromSearch(existingQueue, cards, 'profile-1');

    expect(queue).toHaveLength(2);
    expect(queue[0].title).toBe('Existing');
    expect(queue[1].title).toBe('New');
  });

  it('preserves order', () => {
    const cards: ParsedVacancyCard[] = [
      createCard('100001', 'First'),
      createCard('100002', 'Second'),
      createCard('100003', 'Third'),
    ];

    const queue = materializeVacanciesFromSearch([], cards, 'profile-1');

    expect(queue[0].title).toBe('First');
    expect(queue[1].title).toBe('Second');
    expect(queue[2].title).toBe('Third');
  });

  it('repeated parse does not duplicate', () => {
    const cards: ParsedVacancyCard[] = [
      createCard('100001', 'Vacancy A'),
      createCard('100002', 'Vacancy B'),
    ];

    let queue = materializeVacanciesFromSearch([], cards, 'profile-1');
    expect(queue).toHaveLength(2);

    // Parse same cards again
    queue = materializeVacanciesFromSearch(queue, cards, 'profile-1');
    expect(queue).toHaveLength(2);
  });

  it('markVacancyQueued updates status', () => {
    const queue: VacancyQueueItem[] = [
      {
        vacancyId: '100001',
        url: 'https://hh.ru/vacancy/100001',
        title: 'Test',
        source: 'search_dom',
        discoveredAt: Date.now(),
        profileId: 'profile-1',
        status: 'discovered',
      },
    ];

    const updated = markVacancyQueued(queue, '100001');

    expect(updated[0].status).toBe('queued');
  });

  it('markVacancyProcessed updates status', () => {
    const queue: VacancyQueueItem[] = [
      {
        vacancyId: '100001',
        url: 'https://hh.ru/vacancy/100001',
        title: 'Test',
        source: 'search_dom',
        discoveredAt: Date.now(),
        profileId: 'profile-1',
        status: 'queued',
      },
    ];

    const updated = markVacancyProcessed(queue, '100001');

    expect(updated[0].status).toBe('processed');
  });

  it('markVacancySkipped updates status', () => {
    const queue: VacancyQueueItem[] = [
      {
        vacancyId: '100001',
        url: 'https://hh.ru/vacancy/100001',
        title: 'Test',
        source: 'search_dom',
        discoveredAt: Date.now(),
        profileId: 'profile-1',
        status: 'discovered',
      },
    ];

    const updated = markVacancySkipped(queue, '100001');

    expect(updated[0].status).toBe('skipped');
  });

  it('clearVacancyQueue returns empty array', () => {
    const queue = clearVacancyQueue();
    expect(queue).toEqual([]);
  });
});
