import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Question, QuestionCall } from '../types'

// The questions the assistant is waiting on the person for.
//
// Each session has its own list. The assistant adds to it and clears it with
// the tool this mod registers (mcp__needs-your-word__question); the mod keeps
// the list in a file named after the session:
//   ~/.claude/needs-your-word/<session id>.json
//   { "questions": [ { "id", "ask", "why", "recommend" } ] }
// A question shows only in the session that asked it, however many sessions
// are open in the same repo.
//
// A file written by hand is still read, and shows in every session in its
// repo (a session in <repo>/.claude/worktrees/<name> counts as <repo>):
//   ~/.claude/<repo>_questions.json   (my-app -> my-app_questions.json)
//
// A press never sends anything: it drafts the answer in the prompt box, and the
// person's own Enter sends it. Under Yes and No each question has an "Other"
// box for an answer that is neither; its Enter drafts that text the same way.
// No dim text anywhere in the pane: light grey on the pane's darker grey is
// hard to read. The question is bold in the theme's warning color, the reason
// in its full-strength text color.

const PANE = 'needs-your-word'
const TITLE = 'Needs your word'
const REFRESH_MS = 10000
const TOOL = 'mcp__needs-your-word__question'
const TOOL_DESCRIPTION = [
  'Keeps the list of decisions you are waiting on the person for. The list belongs to this session, and the person sees it in a sidebar with Yes and No buttons and a box for a typed answer.',
  'action "ask" adds a question, or replaces the one with the same id. Give a short id, the question in `ask` (phrase it so yes or no answers it when you can), the reason or the numbers behind it in `why`, and your recommendation in `recommend` (leave it out when you have none). Use it for a decision that is the person\'s to make, when there is other work you can carry on with meanwhile.',
  'The answer arrives as a message from the person that starts with `Answer to "<ask>":`. Act on it, then call action "resolve" with the id to take the question off the list.',
  'action "list" returns the open questions.',
].join('\n')
const TOOL_INPUT = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['ask', 'resolve', 'list'] },
    id: { type: 'string', description: 'A short name for the question, unique in the list.' },
    ask: { type: 'string', description: 'The question.' },
    why: { type: 'string', description: 'The reason or the numbers behind it.' },
    recommend: { type: 'string', description: 'Your recommendation, when you have one.' },
  },
  required: ['action'],
}
const EMPTY: Board = { questions: [], drafted: {}, problem: null }

const board = atom({ plugin: 'needs-your-word', key: 'board' } as const, EMPTY)

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const parse = (raw: string): Question[] => {
  const data: unknown = JSON.parse(raw)
  const list: unknown =
    data !== null && typeof data === 'object' && 'questions' in data
      ? (data as { questions: unknown }).questions
      : data

  if (!Array.isArray(list)) {
    throw new Error('no "questions" list')
  }

  return list
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object',
    )
    .map(item => ({
      id: text(item.id),
      ask: text(item.ask),
      why: text(item.why),
      recommend: text(item.recommend),
    }))
    .filter(item => item.id !== '' && item.ask !== '')
}

// The repo's name: the last folder of the project root, or of the repo that
// holds it when the root is one of its worktrees.
const repoOf = (root: string): string => {
  const repo = root.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '')
  const parts = repo.split('/').filter(part => part !== '')

  return parts.at(-1) ?? ''
}

const repo = async ($: EngineInterface): Promise<string> =>
  repoOf(await $.session.root())

type Paths = { session: string; shared: string | null }

// Where this session's own list is kept, and the hand-written file of its
// repo. Null when HOME is not set: there is then nowhere to keep a list.
const paths = async ($: EngineInterface): Promise<Paths | null> => {
  const home = await $.env.get('HOME')

  if (home === undefined || home === '') {
    return null
  }

  const id = (await $.session.id()).replace(/[^A-Za-z0-9_-]/g, '_')
  const name = await repo($)

  return {
    session: `${home}/.claude/needs-your-word/${id}.json`,
    shared: name === '' ? null : `${home}/.claude/${name}_questions.json`,
  }
}

const load = async ($: EngineInterface, path: string): Promise<Question[]> =>
  (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : []

// This session's questions first, then the repo's hand-written ones; a
// hand-written question with an id the session already uses is left out.
const merge = (own: Question[], shared: Question[]): Question[] => [
  ...own,
  ...shared.filter(item => !own.some(question => question.id === item.id)),
]

// Never rejects: a pass that fails (the session is closing, the mod is
// reloading) is dropped, and the next one tries again.
const refresh = async ($: EngineInterface): Promise<void> => {
  try {
    const at = await paths($)

    if (at === null) {
      await update($, board, () => EMPTY)

      return
    }

    let questions: Question[] = []
    let problem: string | null = null

    try {
      questions = merge(
        await load($, at.session),
        at.shared === null ? [] : await load($, at.shared),
      )
    } catch (error) {
      problem = `The questions file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`
    }

    await update($, board, now => ({
      questions,
      problem,
      // Forget drafts of questions that are gone.
      drafted: Object.fromEntries(
        Object.entries(now.drafted).filter(([id]) =>
          questions.some(question => question.id === id),
        ),
      ),
    }))
  } catch {
    // Dropped.
  }
}

const save = async (
  $: EngineInterface,
  path: string,
  questions: Question[],
): Promise<void> => {
  await $.fs.write(path, `${JSON.stringify({ questions }, null, 2)}\n`)
}

const count = (questions: Question[]): string =>
  `${questions.length} open in this session.`

// The tool, as the assistant calls it: what it reads back is the answer.
const serve = async (
  $: EngineInterface,
  input: QuestionCall,
): Promise<string> => {
  const at = await paths($)

  if (at === null) {
    return 'Not done: HOME is not set, so there is nowhere to keep the list.'
  }

  const action = text(input.action)
  const id = text(input.id).trim()
  const own = await load($, at.session)

  if (action === 'list') {
    const shared = at.shared === null ? [] : await load($, at.shared)

    return JSON.stringify({ questions: merge(own, shared) }, null, 2)
  }

  if (action === 'ask') {
    const ask = text(input.ask).trim()

    if (id === '' || ask === '') {
      return 'Not added: "ask" needs both an id and the question in `ask`.'
    }

    const question: Question = {
      id,
      ask,
      why: text(input.why).trim(),
      recommend: text(input.recommend).trim(),
    }
    const next = [...own.filter(item => item.id !== id), question]

    await save($, at.session, next)
    await refresh($)
    $.ui.toast(`A question needs your word: ${short(ask)}`)

    return `Added "${id}". ${count(next)} The person answers from the sidebar; the answer arrives as a message that starts with: Answer to "${ask}":`
  }

  if (action === 'resolve') {
    if (id === '') {
      return 'Not resolved: "resolve" needs the id of the question.'
    }

    if (!own.some(item => item.id === id)) {
      const shared = at.shared === null ? [] : await load($, at.shared)

      return at.shared !== null && shared.some(item => item.id === id)
        ? `"${id}" is not in this session's list. It is in the hand-written file ${at.shared}; remove it there.`
        : `No open question has the id "${id}". ${count(own)}`
    }

    const next = own.filter(item => item.id !== id)

    await save($, at.session, next)
    await refresh($)

    return `Resolved "${id}". ${count(next)}`
  }

  return 'Unknown action. Use "ask", "resolve" or "list".'
}

// A press drafts the answer in the prompt box. Nothing is sent: the owner's
// own Enter sends it.
const draft = async (
  $: EngineInterface,
  question: Question,
  answer: string,
): Promise<void> => {
  try {
    // A typed answer that already ends a sentence gets no second period.
    const end = /[.!?]$/.test(answer) ? ' ' : '. '
    const filled = await $.prompt.fill({
      text: `Answer to "${question.ask}": ${answer}${end}`,
      mode: 'append',
    })

    if (!filled.isFilled) {
      $.ui.toast('Could not put the answer in the prompt box; type it instead.')

      return
    }

    await update($, board, now => ({
      ...now,
      drafted: { ...now.drafted, [question.id]: answer },
    }))
    $.ui.toast(`Drafted "${short(answer)}" in the prompt box. Press Enter to send it.`)
  } catch {
    $.ui.toast('Could not put the answer in the prompt box; type it instead.')
  }
}

// The "Other" box: its text, trimmed, drafted like a Yes or No press.
const draftOther = async (
  $: EngineInterface,
  question: Question,
  typed: string,
): Promise<void> => {
  const answer = typed.trim()

  if (answer === '') {
    $.ui.toast('Type your answer in the box first, then press Enter.')

    return
  }

  await draft($, question, answer)
}

const short = (answer: string): string =>
  answer.length > 40 ? `${answer.slice(0, 39)}…` : answer

const open = async ($: EngineInterface): Promise<void> => {
  try {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  } catch {
    // No surface to open it on.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'word',
      description: 'Open the list of questions that need your word',
    })
    await $.tool.register({
      name: 'question',
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_INPUT,
      isDeferred: false,
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })

    return next(e)
  })

  // Answered here, ahead of the permission check: the tool changes nothing
  // but this session's own list.
  on('tool.call', { tool: TOOL }, async ($, e) => ({
    result: await serve($, e),
  })).catch(() => ({
    deny: 'needs-your-word: the list could not be read or changed.',
  }))

  on('command.run', { command: 'word' }, async $ => {
    await refresh($)
    await open($)

    return { text: 'Questions panel opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, board)
    const waiting = now.questions.filter(
      question => now.drafted[question.id] === undefined,
    ).length

    if (e.props.hasSurvey || waiting === 0) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Text bold>
          {waiting} {waiting === 1 ? 'question needs' : 'questions need'} your word
        </Text>
        <Button
          key="open-word"
          label="Open"
          onPress={() => {
            void open($)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const now = await read($, board)
    const name = await repo($)
    const nothing =
      name === ''
        ? 'Nothing is waiting on you in this session.'
        : `Nothing is waiting on you in this session (${name}).`

    // The desktop app's small form of a minimized pane: clicks may not reach
    // it, so it only says how many are waiting.
    if (e.props.placement === 'widget') {
      const waiting = now.questions.filter(
        question => now.drafted[question.id] === undefined,
      ).length

      return (
        <Text bold color={waiting === 0 ? 'text' : 'warning'}>
          {waiting === 0
            ? 'Nothing is waiting on you.'
            : `${waiting} ${waiting === 1 ? 'question needs' : 'questions need'} your word`}
        </Text>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {now.problem !== null && (
          <Text bold color="error">
            {now.problem}
          </Text>
        )}
        {now.problem === null && now.questions.length === 0 && (
          <Text color="text">{nothing}</Text>
        )}
        {now.questions.map((question, index) => {
          const drafted = now.drafted[question.id]

          return (
            <Box key={`q-${question.id}`} flexDirection="column">
              <Text bold color="warning">
                {index + 1}. {question.ask}
              </Text>
              {question.why !== '' && <Text color="text">{question.why}</Text>}
              {question.recommend !== '' && (
                <Text
                  bold
                  color={question.recommend === 'yes' ? 'success' : 'text'}
                >
                  Recommended: {question.recommend}
                </Text>
              )}
              <Box flexDirection="row" gap={2}>
                <Button
                  key={`yes-${question.id}`}
                  label="Yes"
                  onPress={() => {
                    void draft($, question, 'yes')
                  }}
                />
                <Button
                  key={`no-${question.id}`}
                  label="No"
                  onPress={() => {
                    void draft($, question, 'no')
                  }}
                />
                {drafted !== undefined && (
                  <Text bold color="text">
                    drafted: {short(drafted)} (press Enter in the prompt box)
                  </Text>
                )}
              </Box>
              <Input
                key={`other-${question.id}`}
                label="Other:"
                placeholder="neither? type your answer, Enter drafts it"
                value=""
                submitLabel="draft"
                rows={2}
                onSubmit={value => {
                  void draftOther($, question, value)
                }}
              />
            </Box>
          )
        })}
      </Box>
    )
  })
}
