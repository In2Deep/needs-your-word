import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Question } from '../types'

// The open questions for the owner, kept by the assistant in one JSON file per
// repo, named after the folder the session runs in:
//   ~/.claude/<repo>_questions.json   (my-app -> my-app_questions.json)
//   { "questions": [ { "id", "ask", "why", "recommend" } ] }
// A session in a worktree (<repo>/.claude/worktrees/<name>) reads its repo's
// file. A repo without a file shows nothing: no other repo's questions.
// A press never sends anything: it drafts the answer in the prompt box, and the
// owner's own Enter sends it. Under Yes and No each question has an "Other"
// box for an answer that is neither; its Enter drafts that text the same way.
// No dim text anywhere in the pane: light grey on the pane's darker grey is
// hard to read. The question is bold in the theme's warning color, the reason
// in its full-strength text color.

const PANE = 'needs-your-word'
const TITLE = 'Needs your word'
const REFRESH_MS = 10000
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

// Never rejects: a pass that fails (the session is closing, the mod is
// reloading) is dropped, and the next one tries again.
const refresh = async ($: EngineInterface): Promise<void> => {
  try {
    const name = await repo($)
    const home = await $.env.get('HOME')

    if (name === '' || home === undefined) {
      await update($, board, () => EMPTY)

      return
    }

    const path = `${home}/.claude/${name}_questions.json`
    let questions: Question[] = []
    let problem: string | null = null

    try {
      if (await $.fs.exists(path)) {
        questions = parse(await $.fs.read(path))
      }
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
    await refresh($)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })

    return next(e)
  })

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

    return (
      <Box flexDirection="column" gap={1}>
        {now.problem !== null && (
          <Text bold color="error">
            {now.problem}
          </Text>
        )}
        {now.problem === null && now.questions.length === 0 && (
          <Text color="text">Nothing is waiting on you in {name || 'this folder'}.</Text>
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
