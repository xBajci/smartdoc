# Chat feedback

Date: 2026-11-20

## Goal

A visitor asks the chat and gets an answer. Today nobody learns whether the visitor found
what they were looking for. The administrator sees every question in "Ladění chatu", but
not what the visitor thought of the answers.

We want:

- The visitor can say, with one click, whether an answer helped. The form is quiet: two
  small buttons under the answer, no dialog, no required step.
- The administrator sees the feedback at each question in "Ladění chatu" and can filter
  the sessions by it.

## Scope

In scope:

- Visitor chat panel (`src/chat/ChatPanel.tsx`): two buttons right under each answer.
- Backend: store the feedback of an answer, read it with the questions and the sessions.
- Admin UI "Ladění chatu" (`src/routes/sprava.chat.tsx`): a label on each question, counts
  on each session and a filter of the sessions.

Out of scope:

- A text note from the visitor. Only yes or no.
- Taking feedback back. The visitor can change it, not remove it.
- Feedback buttons in the administrator's test questions in "Ladění chatu".
- Statistics, charts, exports, notifications.

## Decisions

| Question | Decision |
|---|---|
| What is rated? | One answer. The first design rated the whole conversation; it was changed before release, because the administrator debugs single questions and must know which answer was bad. |
| What can the visitor say? | "Odpověď pomohla" or "Odpověď nepomohla". No text. |
| Can the visitor change it? | Yes, by pressing the other button, as long as the page is open. |
| Where is it stored? | Two columns on `chat_traces`. A trace is one question with its answer. |
| Who may rate an answer? | Whoever has the id of its trace. Only the asker gets it, with the answer. |
| What happens to sessions? | Nothing. Questions stay grouped by `session_id`, and "Ladění chatu" still lists and opens whole sessions. |

## Visitor: the chat panel

Right under the text of each answer, before its sources, there are two small icon
buttons: thumb up ("Odpověď pomohla") and thumb down ("Odpověď nepomohla").

| Moment | What the visitor sees |
|---|---|
| The answer is being made, or the chat reported a problem | No buttons. |
| An answer arrived | Both buttons, neither pressed. |
| After a click | The chosen button is pressed, and "Děkujeme za hodnocení." is next to the buttons. |
| A click on the other button | That button is pressed instead. |
| The feedback could not be stored | No button changes, and "Hodnocení se nepodařilo uložit." is next to the buttons. |
| "Nový chat" | The conversation is gone with its buttons. The stored feedback stays. |

Rules:

- The buttons show when the message holds a `traceId`. The panel gets one only with an
  answer.
- "V archivu jsem k tomu nic nenašel." is an answer. It has the buttons.
- Both buttons are disabled while the feedback is being stored.
- The feedback "could not be stored" when the call fails or the server answers `ok: false`.
- The buttons are small and muted. They are a group with the label "Hodnocení odpovědi";
  each button has its name as a label, and the thanks and the failure are a status.
- The panel keeps the choice in the message, in memory. A closed page forgets it.

Texts go in `src/copy/cs.ts` under `cs.chat.feedback`.

## Backend

### Data

`chat_traces` gets two columns:

- `helpful` (boolean, nullable). `true` for "pomohla", `false` for "nepomohla", `null`
  until the visitor says.
- `rated_at` (timestamp with time zone, nullable). When the visitor last said it.

Migration: `pnpm db:generate` makes the next file in `drizzle/`. No data is changed; old
traces have no feedback.

### Storing feedback

`rateChatAnswer(traceId, helpful)` in `src/server/chat/chat-service.ts` is one update of
the trace with that id, only when the trace has an answer (no error, answer not empty).
It returns whether a row was changed.

`rateChatFn` in `src/server/archive.ts` (POST, open to visitors):

- Input `{ traceId, helpful }`. `traceId` must match `UUID`, `helpful` must be a boolean;
  anything else is "Invalid input.".
- Output `{ ok: boolean }`.

Limits: none of its own. The id of a trace is a random UUID made by the server and given
only to the asker, and feedback adds no rows. Questions stay limited as today.

### Reading feedback

- `ChatTraceSummary` gets `helpful: boolean | null`.
- `ChatSessionSummary` gets `helpfulAnswers` and `unhelpfulAnswers`: how many answers of
  the session got each word.
- `listChatSessions(filter)` takes a filter: `'all' | 'rated' | 'helpful' | 'unhelpful'`.
  A session passes when at least one of its answers has such feedback, so a session with
  both words is under "helpful" and under "unhelpful". The filter is applied in the query,
  before the limit of 100 sessions, so a filtered list reaches older sessions too.
- `getChatSessionsFn` takes `{ filter }`; an unknown value means `'all'`.

## Admin UI: "Ladění chatu"

- **Filter.** Above the list of sessions, a group "Hodnocení" of four toggle buttons:
  "Vše", "S hodnocením", "Kladné", "Záporné". One is pressed; "Vše" at the start.
- **Address.** The filter is in the address as `?hodnoceni=s-hodnocenim`, `kladne` or
  `zaporne`; without it the list shows all sessions. The route loader reads it, so a
  reload and a shared link keep the filter.
- **List.** A session carries "Pomohla: N" and "Nepomohla: N" for the counts above zero.
- **Empty filtered list.** "Žádný rozhovor s tímto hodnocením."
- **Open session.** Each question carries the label "Pomohla" or "Nepomohla", or no label
  when its answer has no feedback.
- The filter is hidden while a session is open, like the list it belongs to.

Texts go in `src/copy/cs.ts` under `cs.chatDebug`.

## Tests

Rule: every change gets a `.feature` and a matching Playwright E2E test
(`features/README.md`). English Gherkin keywords, Czech steps.

`features/public/chat.feature` and `e2e/public/chat.spec.ts`:

- Hodnocení je pod každou odpovědí, pod hlášením chyby není.
- Návštěvník ohodnotí odpověď a hodnocení může změnit.
- Každá odpověď má své hodnocení.
- Hodnocení odpovědi, jejíž záznam byl smazán, se neuloží.

`features/admin/ladeni-chatu.feature` and `e2e/admin/ladeni-chatu.spec.ts`:

- Otázka s hodnocením má štítek a rozhovor ukazuje počty hodnocení.
- Filtr ukáže jen rozhovory s hodnocením, jen s kladným, nebo jen se záporným.
- Rozhovor s kladným i záporným hodnocením je v obou filtrech.
- Filtr zůstane po novém načtení stránky.

No unit test: the logic is one update and one grouped query, and the E2E tests cover both.

## Risks

- Few visitors will click. Feedback is a sample, not a measure of every answer.
- A visitor rates the answer, not the search. A good answer from the wrong document can
  still get "pomohla".
- Production needs the migration (`pnpm db:migrate`) with the deploy.
