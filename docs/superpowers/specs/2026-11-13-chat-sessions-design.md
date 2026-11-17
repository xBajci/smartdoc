# Chat sessions

Date: 2026-11-13

## Goal

Today every question to the chat is a separate row in `chat_traces`. The browser holds the
conversation and sends the history with each question. Two questions of one conversation
look like two unrelated rows in "Ladění chatu".

We want:

- One **session** per conversation, with a `session_id`.
- The server keeps the context. A visitor can resume a session the next day.
- The administrator sees whole sessions in "Ladění chatu" and sees how context passes
  from one question to the next.

## Scope

In scope:

- Backend: sessions, history built by the server, resume by `session_id`.
- Admin UI: "Ladění chatu" shows sessions.

Out of scope:

- Visitor UI for resume. The visitor chat panel (`src/chat/ChatPanel.tsx`) gets only the
  change the new API needs (see Risks).
- Session expiry, deleting sessions, session owners, session titles.

## Decisions

| Question | Decision |
|---|---|
| Who can resume a session? | Every visitor, with the `session_id`. Backend only. |
| Where does the history come from? | The server. It reads earlier traces of the session. |
| How is a session stored? | A new column `session_id` on `chat_traces`. No new table. |

## Backend

### Data

`chat_traces` gets two columns:

- `session_id` (text, not null). Index on (`session_id`, `created_at`).
- `history` (jsonb, `ChatTurn[]`, not null, default `[]`). The exact history the model
  received for this question.

Migration: old traces get `session_id = id`. Each old question becomes its own session.
We cannot know which old rows belonged together. Old traces get `history = []`.

### Asking a question

`ChatQuestion` loses `history` and gets an optional `sessionId`.

- No `sessionId`: the server makes a random UUID. The session starts.
- `sessionId` known: the question joins that session.
- `sessionId` unknown: the server starts a new session with a new UUID. It does not error.
  It never reuses an unknown id from the client, so a visitor cannot choose their own id.
- The `session_id` is a random UUID, so nobody can guess it. It is the only key to a
  session. Possession of the id is the right to resume.

`ChatAnswer` (the `ok: true` case) returns `sessionId` next to `traceId`.

The server builds the history:

1. Read the traces of the session, oldest first.
2. Skip traces with an error or an empty answer.
3. Turn each remaining trace into two turns: the question (`visitor`) and the answer
   (`archive`).
4. Keep the last `historyMessages` turns. This is the existing setting.
5. Save these turns in the new trace as `history`. Pass them to the answerer.

`MAX_HISTORY_TURNS` and the history validation in `src/server/archive.ts` go away, because
the browser no longer sends history.

Scope (`archive` or `documents`) stays per question, as today.

### Limits

The hourly and daily limits stay per visitor (`askerHash`). They do not change.

### Admin read functions

- `listChatSessions()`: one row per session, newest activity first, at most 100 sessions.
  Each row has `sessionId`, the first question, the number of questions, the time of the
  last question, the total duration, the total cost, and whether any question failed.
- `findChatSession(sessionId)`: the traces of one session, oldest first, as
  `ChatTraceSummary` rows.
- `findChatTrace(id)` stays. It now also returns `sessionId` and `history`.

`listChatTraces()` is replaced by `listChatSessions()`.

## Admin UI: "Ladění chatu"

Route: `src/routes/sprava.chat.tsx`. Texts go in `src/copy/cs.ts`.

- **The list** shows one row per session. The title is the first question. Each row shows
  the number of questions, the time of the last question, the total duration and the
  total cost.
- **A click opens the session.** The page shows all questions in order, oldest first.
  The session id is shown, with a copy button.
- **A click on a question** opens its full trace, as today. The trace now has a block
  "Historie pro model" with the turns the model received.
- **The test question box** continues the open session. The button "Nový rozhovor"
  closes the session. With no session open, a test question starts a new session.

## Tests

Rule: every change gets a `.feature` and a matching Playwright E2E test
(`docs/tests/bdd.md`). English Gherkin keywords, Czech steps.

- Update `features/admin/ladeni-chatu.feature` and `e2e/admin/ladeni-chatu.spec.ts`.
  The scenario "Otázka návštěvníka je v ladění i v záznamech AI s cenou" now expects one
  session with two questions.
- New scenarios:
  - Two questions of one visitor chat appear as one session.
  - The second question shows the history the model got.
  - The administrator continues a session with a test question.
  - "Nový rozhovor" starts a new session.
  - Resume: a question with a known `sessionId` joins the session. The history comes from
    the server.
  - Resume: a question with an unknown `sessionId` starts a new session.
  - A failed question is not in the history of the next question.
- Unit test (Vitest) for the function that turns traces into history. It has a case with
  more traces than `historyMessages`, and a case with a failed trace.

## Risks

- Old sessions are one question each. The admin will see many one-question sessions
  from before this change. This is accepted.
- The visitor panel must keep working. `ChatPanel.tsx` gets the smallest change: it keeps
  the `sessionId` from the last answer in memory and sends it with the next question. It
  stops sending history. This is not a resume UI. The `sessionId` is lost when the page
  closes.
