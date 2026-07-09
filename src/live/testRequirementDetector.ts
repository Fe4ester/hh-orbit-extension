export function detectTestRequirement(doc: Document, url: string): boolean {
  return (
    !!doc.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
    (doc.body.textContent?.includes('Работодатель просит ответить на вопросы') ?? false) ||
    (doc.body.textContent?.includes('тестовое задание') ?? false) ||
    (doc.body.textContent?.includes('Пройти тест') ?? false) ||
    url.includes('startedWithQuestion=true')
  );
}
