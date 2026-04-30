/**
 * Константы для параметров фильтров HH.ru
 * Используются для построения UI и формирования поисковых запросов
 */

export interface FilterOption {
  code: string;
  label: string;
}

/**
 * Опыт работы
 * Соответствует параметру experience в API HH.ru
 */
export const HH_EXPERIENCE_OPTIONS: FilterOption[] = [
  { code: 'noExperience', label: 'Нет опыта' },
  { code: 'between1And3', label: 'От 1 года до 3 лет' },
  { code: 'between3And6', label: 'От 3 до 6 лет' },
  { code: 'moreThan6', label: 'Более 6 лет' },
];

/**
 * График работы
 * Соответствует параметру schedule в API HH.ru
 */
export const HH_SCHEDULE_OPTIONS: FilterOption[] = [
  { code: 'remote', label: 'Удаленная работа' },
  { code: 'fullDay', label: 'Полный день' },
  { code: 'shift', label: 'Сменный график' },
  { code: 'flexible', label: 'Гибкий график' },
  { code: 'flyInFlyOut', label: 'Вахтовый метод' },
];

/**
 * Тип занятости
 * Соответствует параметру employment в API HH.ru
 */
export const HH_EMPLOYMENT_OPTIONS: FilterOption[] = [
  { code: 'full', label: 'Полная занятость' },
  { code: 'part', label: 'Частичная занятость' },
  { code: 'project', label: 'Проектная работа' },
  { code: 'volunteer', label: 'Волонтерство' },
  { code: 'probation', label: 'Стажировка' },
];

/**
 * Формат работы (work_format)
 * Соответствует параметру work_format в форме расширенного поиска HH.ru
 */
export const HH_WORK_FORMAT_OPTIONS: FilterOption[] = [
  { code: 'REMOTE', label: 'Удаленная работа' },
  { code: 'ON_SITE', label: 'Офис' },
  { code: 'HYBRID', label: 'Гибрид' },
  { code: 'FIELD_WORK', label: 'Вахта' },
];

/**
 * Частота выплат (salary_frequency)
 * Соответствует параметру salary_frequency в форме расширенного поиска HH.ru
 */
export const HH_SALARY_FREQUENCY_OPTIONS: FilterOption[] = [
  { code: 'MONTHLY', label: 'В месяц' },
  { code: 'ANNUAL', label: 'В год' },
  { code: 'HOURLY', label: 'В час' },
  { code: 'DAILY', label: 'В день' },
];

/**
 * Вспомогательные функции для работы с опциями
 */

/**
 * Получить label по code для опыта работы
 */
export function getExperienceLabel(code: string): string {
  return HH_EXPERIENCE_OPTIONS.find(opt => opt.code === code)?.label || code;
}

/**
 * Получить label по code для графика работы
 */
export function getScheduleLabel(code: string): string {
  return HH_SCHEDULE_OPTIONS.find(opt => opt.code === code)?.label || code;
}

/**
 * Получить label по code для типа занятости
 */
export function getEmploymentLabel(code: string): string {
  return HH_EMPLOYMENT_OPTIONS.find(opt => opt.code === code)?.label || code;
}

/**
 * Получить label по code для формата работы
 */
export function getWorkFormatLabel(code: string): string {
  return HH_WORK_FORMAT_OPTIONS.find(opt => opt.code === code)?.label || code;
}

/**
 * Получить label по code для частоты выплат
 */
export function getSalaryFrequencyLabel(code: string): string {
  return HH_SALARY_FREQUENCY_OPTIONS.find(opt => opt.code === code)?.label || code;
}
