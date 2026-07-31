# HH.ru backend apply contract

Source: current extension implementation plus backend HTTP tests. This file deliberately records no session cookie, XSRF value, account identifiers, or response body dumps.

## Authentication boundary

| Concern | Contract |
|---|---|
| Browser session | `fetch(..., { credentials: 'include' })` on `hh.ru` |
| Fast local auth check | presence of either `hhtoken` or `_xsrf` cookie for `https://hh.ru` |
| Server-side auth failure | HTTP `401`/`403` maps to `auth_required` |
| CSRF source | cookie `_xsrf`, read with `chrome.cookies.get` |
| CSRF transport | request header `X-Xsrftoken`; multipart apply body also contains `_xsrf` |
| Logging rule | log only `hasXsrfToken`, header/body key names and response shape; never token/cookie values |

## Search and resume contracts

### Vacancy acquisition

```text
GET https://hh.ru/search/vacancy
query:
  items_on_page=50
  page=<zero-based integer>
  resume=<selected resume hash>        # required
headers:
  Accept: text/html,...
  Referer: https://hh.ru/
credentials: include
```

- `api.hh.ru/vacancies` is intentionally not used for automatic search because the project treats it as blocked (`403`).
- HTML card marker: `data-qa="vacancy-serp__vacancy"`.
- backend and live acquisition share the same search-results parser so selector updates have one implementation path.
- expected fields: vacancy ID from `/vacancy/<digits>`, title (`serp-item__title`), employer (`vacancy-serp__vacancy-employer`), compensation, address, full/relative vacancy URL.
- the selected resume hash is passed directly from the initialized state store; the HTTP client never re-reads extension storage.
- missing resume context, non-OK responses, login/captcha pages, parser contract mismatches, and unrecognized HTML are acquisition errors. They do not increment the empty-page exhaustion counter.

### Resume discovery

```text
GET https://api.hh.ru/resumes/mine
credentials: include
header: User-Agent: HH-Orbit-Extension/1.0
```

- Response mapping: `items[].id -> hash`, `items[].title -> title`, `items[].alternate_url -> url`.
- non-OK/exception returns an empty list.
- UI fallback remains required because the live resume list exposes search hashes and its DOM can change.

## Apply protocol

Endpoint for both preflight and submit:

```text
https://hh.ru/applicant/vacancy_response/popup
```

### 1. Preflight

```text
GET /applicant/vacancy_response/popup
query:
  vacancyId=<vacancy id>
  resumeHash=<resume hash>
  lux=true
  alreadyApplied=false
  isTest=no
  withoutTest=no
headers:
  Accept: application/json
  X-Requested-With: XMLHttpRequest
  Referer: https://hh.ru/
credentials: include
```

Observed/implemented preflight response states:

| Signal | Classified result | Backend action |
|---|---|---|
| `type=alreadyApplied` or `responseStatus.alreadyApplied=true` | `already_applied` | no POST |
| `type=testRequired`, `type=test-required`, or `responseStatus.test.hasTests=true` | `test_required` | no POST; manual/browser path required |
| `type=questionnaireRequired`, `questionnaireRequired=true`, or nested questionnaire flags | `questionnaire_required` | no POST; manual/browser path required |
| `responseStatus.shortVacancy.@responseLetterRequired=true` | `cover_letter_required` plus optional `letterMaxLength` | use template-backed multipart POST or create manual action |
| `type=quickResponse` without blockers | proceed | form POST allowed |
| `type=modal` without blockers | proceed | form POST allowed |
| new/unknown `type` | `unknown_preflight_type:<type>` | block conservatively |
| HTTP 401/403 | `auth_required` | stop/re-authenticate |

The parallel `PreflightService` also exposes relocation state:

```text
relocationWarning.show = true
relocationWarning.regionTrl -> relocationRegion
```

This is a modal state, not a success state.

### 2. Submit without cover letter

```text
POST /applicant/vacancy_response/popup
Content-Type: application/x-www-form-urlencoded
headers:
  Accept: application/json
  X-Requested-With: XMLHttpRequest
  Referer: <context referer or https://hh.ru/>
  x-hhtmfrom: <context hhtmFrom or negotiation_list>
  x-hhtmsource: <context hhtmSource or main>
  X-Xsrftoken: <present only when cookie exists>
body:
  resume_hash
  vacancy_id
  lux=true (default)
  ignore_postponed=true (default)
  mark_applicant_visible_in_vacancy_country=false
  country_ids=[]
credentials: include
```

### 3. Submit with cover letter

```text
POST /applicant/vacancy_response/popup
Content-Type: multipart/form-data          # browser assigns boundary
body:
  _xsrf                                  # if available
  vacancy_id
  resume_hash
  ignore_postponed=true
  incomplete=false
  mark_applicant_visible_in_vacancy_country=false
  country_ids=[]
  letter=<trimmed template text>
  lux=true
  withoutTest=no
  hhtmFromLabel=<context source>
  hhtmSourceLabel=<context source>
```

## Apply response normalization

| Response signal | Outcome |
|---|---|
| `success === 'true'` (string), `topic_id`, `chat_id`, or non-empty `responseStatus.negotiations.topicList` | `success` |
| `alreadyApplied=true` / `type=alreadyApplied` / HTML `Вы уже откликались` | `already_applied` |
| test signals above | `test_required` |
| questionnaire signals above or HTML `vacancy-response-questionnaire` / `Работодатель просит ответить на вопросы` | `questionnaire_required` |
| `error` or `reason` equal to `letter-required` / `letter_required`; letter flag; or HTML letter UI | `cover_letter_required` |
| HTML `Отклик отправлен`, `vacancy-response-success`, `vacancy-response-submit-popup`, `popup_success` | `success` |
| HTTP >=500 | `server_error` |
| unknown JSON/HTML body | `unknown` or diagnosable `error` with status, keys/type/error signal and a bounded preview |

## Runtime outcome rules

- Count an auto-apply only for `success`; do not consume the success limit for skipped/manual/blocked/error cases.
- `already_applied`, test, questionnaire, cover-letter and relocation are distinct outcomes — never flatten them to a generic success/error.
- If cover letter template is absent, too long for `letterMaxLength`, or the POST still returns a letter blocker: create the corresponding manual action, do not report success.
- Keep `chat available` separate from `application sent`: a negotiation can already exist, and a chat button is not evidence that the latest POST succeeded.

## Evidence and limitations

- Unit coverage exercises JSON and `text/html` branches, non-OK response preservation, multipart/urlencoded body shape, test/questionnaire/cover-letter mappings and logging hygiene.
- The persistent Scrapling MCP session is read/navigation-only; its exposed methods do not provide `click`, `fill` or `submit`. Therefore live capture of a questionnaire or cover-letter form cannot be produced from that MCP alone. It requires an interactive browser-control MCP connected to this same authenticated profile, or a controlled manual click by the user while capturing the resulting URL/HTML.

## Live evidence: test-required is a questionnaire branch

Read-only preflight was executed in the authenticated persistent MCP session for vacancy `135204532` and the selected resume. It returned:

```json
{
  "type": "test-required",
  "redirect_uri": "/applicant/vacancy_response?vacancyId=135204532&startedWithQuestion=false",
  "relocationWarning": { "show": false }
}
```

The redirect page is a form, not an automatically completable result:

```text
GET /applicant/vacancy_response?vacancyId=<id>&startedWithQuestion=false

title: "Отклик на вакансию"
blocker text: "Для отклика необходимо ответить на несколько вопросов работодателя"
section: "Ответьте на вопросы"
question controls: free-text "Писать тут"
resume selector: "Резюме для отклика"
optional cover-letter control: "Сопроводительное письмо" -> "Добавить"
submit: "Откликнуться"
exit: "Перейти к вакансии"
```

Live questions on this instance were employer-specific free-text questions about city of residence and desired net salary. They must not be answered by automation without user-provided answers. Important correction for runtime semantics: `type=test-required` is a broad backend blocker label; the redirect can expose an employer questionnaire rather than a literal skills test. The extension should preserve the raw preflight type and separately classify the rendered redirect form.

## Live evidence: ordinary modal

Preflight for vacancies `135028157`, `134167390`, `134620983`, `134005516`, and `135141934` returned `type=modal` with:

```text
responseStatus.test.hasTests=false
responseStatus.shortVacancy.@responseLetterRequired=false
responseStatus.negotiations.topicList=[]
responseStatus.letterMaxLength=10000
```

This is a normal candidate for a no-letter POST after the UI/modal requirements are checked. It is not proof of a successful application.

## Live evidence: cover-letter plus relocation modal

Preflight scan of 47 current backend-search vacancies found cover-letter modal states for vacancy IDs `135096772`, `135184497`, `135096774`, `135096773`, and `135216287`.

Detailed read-only evidence for `135096772`:

```json
{
  "type": "modal",
  "responseStatus.test.hasTests": false,
  "responseStatus.shortVacancy.@responseLetterRequired": true,
  "responseStatus.letterMaxLength": 10000,
  "responseStatus.negotiations.topicList": [],
  "relocationWarning.show": true
}
```

The vacancy title was `Python-разработчик (Junior+ /Middle)`. This confirms a compound manual state:

```text
preflight modal
  -> cover letter required (maximum 10,000 characters)
  -> relocation confirmation required
  -> application POST must not be assumed safe until both requirements are explicitly handled
```

Runtime requirement: keep `cover_letter_required` and `relocationWarning.show` independently represented. A profile template can satisfy only the former; it cannot silently confirm the user's relocation decision.
