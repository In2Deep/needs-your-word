import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FILE = '/Users/owner/.claude/my-app_questions.json'
const QUESTIONS = JSON.stringify({
  questions: [
    {
      id: 'node18',
      ask: 'Drop Node 18 support?',
      why: 'CI spends 4 minutes a run on it.',
      recommend: 'yes',
    },
    { id: 'rename', ask: 'Rename the config file?', why: '', recommend: '' },
  ],
})

// The engine beneath the mod: files in memory, and every draft put in the
// prompt box kept in `filled`. Nothing here can send a prompt.
const TOOL = 'mcp__needs-your-word__question'
const LIST = (session: string) => `/Users/owner/.claude/needs-your-word/${session}.json`

const engine = (
  on: On,
  files: Record<string, string>,
  root = '/Users/owner/my-app',
  session = 'session-a',
) => {
  const world = {
    files: { ...files },
    filled: [] as string[],
    toasts: [] as string[],
    submitted: 0,
  }

  mock.env(on, { HOME: '/Users/owner' })
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: session }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('tool.call', () => ({ deny: 'no hook answered' }))
  on('fs.write', (_, e) => {
    world.files[e.path] = e.text

    return { value: undefined }
  })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'word' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: e.path in world.files }))
  on('fs.read', (_, e) => ({ value: world.files[e.path] ?? '' }))
  on('prompt.fill', (_, e) => {
    world.filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    world.submitted += 1

    return { text: e.text }
  })

  return world
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const SITE = { scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
const BAND = {
  plugin: 'needs-your-word',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 120,
    ...SITE,
  },
} as const
const PANE = {
  plugin: 'needs-your-word',
  component: 'Pane',
  requestId: 'needs-your-word',
  props: {
    title: 'Needs your word',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    ...SITE,
  },
} as const

test('Yes drafts the answer in the prompt box and sends nothing', async ($, on) => {
  const world = engine(on, { [FILE]: QUESTIONS })

  await $.session.start(START)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /your word/ }))?.text).toBe(
    '2 questions need your word',
  )
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Drop Node 18 support\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Recommended: yes/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Rename the config file\?/ })).toBeDefined()

  await pane.press({ key: 'yes-node18' })
  expect(world.filled).toEqual(['Answer to "Drop Node 18 support?": yes. '])
  expect(world.submitted).toBe(0)
  await pane.unmount()

  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /drafted: yes/ })).toBeDefined()
  await after.press({ key: 'no-rename' })
  expect(world.filled[1]).toBe('Answer to "Rename the config file?": no. ')
  expect(world.submitted).toBe(0)
  await after.unmount()
})

test('no file: nothing is waiting; a broken file says so', async ($, on) => {
  const world = engine(on, {})

  await $.session.start(START)
  const empty = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await empty.find({ type: 'Text' }))?.text).toBe(
    'Nothing is waiting on you in this session (my-app).',
  )
  await empty.unmount()

  world.files[FILE] = '{ not json'
  await $.command.run({
    command: 'word',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  const broken = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await broken.find({ type: 'Text' }))?.text).toStartWith(
    'The questions file could not be read',
  )
  await broken.unmount()
})

test('Other: the typed answer is drafted, trimmed, and nothing is sent', async ($, on) => {
  const world = engine(on, { [FILE]: QUESTIONS })

  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Input', key: 'other-node18' })).toBeDefined()
  expect(await pane.find({ type: 'Input', key: 'other-rename' })).toBeDefined()

  // An empty box drafts nothing and says what to do.
  await pane.input({ key: 'other-node18', text: '   ' })
  expect(world.filled).toEqual([])
  expect(world.toasts.at(-1)).toBe('Type your answer in the box first, then press Enter.')

  await pane.input({ key: 'other-node18', text: '  only after the next release  ' })
  expect(world.filled).toEqual([
    'Answer to "Drop Node 18 support?": only after the next release. ',
  ])

  // A typed answer that ends its own sentence gets no second period.
  await pane.input({ key: 'other-rename', text: 'Show me the CI numbers first.' })
  expect(world.filled[1]).toBe('Answer to "Rename the config file?": Show me the CI numbers first. ')
  expect(world.submitted).toBe(0)
  await pane.unmount()

  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /drafted: only after the next release/ })).toBeDefined()
  await after.unmount()
})

for (const surface of ['desktop', 'mobile'] as const) {
  test(`${surface}: Yes, No and the Other box are all drawn`, async ($, on) => {
    const world = engine(on, { [FILE]: QUESTIONS })

    await $.session.start({ ...START, surface })
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Button', key: 'yes-node18' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'no-node18' })).toBeDefined()
    await pane.input({ key: 'other-node18', text: 'later' })
    expect(world.filled).toEqual(['Answer to "Drop Node 18 support?": later. '])
    await pane.unmount()
  })
}

test('another repo never shows my-app questions', async ($, on) => {
  engine(on, { [FILE]: QUESTIONS }, '/Users/owner/claude-mods')

  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /your word/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text' }))?.text).toBe(
    'Nothing is waiting on you in this session (claude-mods).',
  )
  expect(await pane.find({ type: 'Text', text: /Node 18/ })).toBeUndefined()
  await pane.unmount()
})

test("a repo's own file is read: <repo>_questions.json", async ($, on) => {
  const own = JSON.stringify({
    questions: [{ id: 'icon', ask: 'Add an icon?', why: '', recommend: '' }],
  })
  engine(
    on,
    { [FILE]: QUESTIONS, '/Users/owner/.claude/claude-mods_questions.json': own },
    '/Users/owner/claude-mods',
  )

  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Add an icon\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Node 18/ })).toBeUndefined()
  await pane.unmount()
})

test("a worktree reads its repo's questions", async ($, on) => {
  engine(on, { [FILE]: QUESTIONS }, '/Users/owner/my-app/.claude/worktrees/fix-login')

  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Drop Node 18 support\?/ })).toBeDefined()
  await pane.unmount()
})

const ASK = {
  tool: TOOL,
  action: 'ask',
  id: 'deploy',
  ask: 'Deploy on Friday?',
  why: 'The fix is ready; the next window is Monday.',
  recommend: 'no',
} as const

test('the tool adds a question to this session, and resolve takes it off', async ($, on) => {
  const world = engine(on, {})

  await $.session.start(START)
  const added = await $.tool.call(ASK)
  expect(String(added.result)).toStartWith('Added "deploy". 1 open in this session.')
  expect(world.toasts.at(-1)).toBe('A question needs your word: Deploy on Friday?')
  expect(JSON.parse(world.files[LIST('session-a')] ?? '{}')).toEqual({
    questions: [
      {
        id: 'deploy',
        ask: 'Deploy on Friday?',
        why: 'The fix is ready; the next window is Monday.',
        recommend: 'no',
      },
    ],
  })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Deploy on Friday\?/ })).toBeDefined()
  await pane.press({ key: 'no-deploy' })
  expect(world.filled).toEqual(['Answer to "Deploy on Friday?": no. '])
  await pane.unmount()

  // Asking again with the same id replaces the question.
  await $.tool.call({ ...ASK, ask: 'Deploy on Monday?' })
  const listed = await $.tool.call({ tool: TOOL, action: 'list' })
  expect(JSON.parse(String(listed.result)).questions.map((q: { ask: string }) => q.ask)).toEqual([
    'Deploy on Monday?',
  ])

  const resolved = await $.tool.call({ tool: TOOL, action: 'resolve', id: 'deploy' })
  expect(String(resolved.result)).toBe('Resolved "deploy". 0 open in this session.')
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await after.find({ type: 'Text' }))?.text).toBe(
    'Nothing is waiting on you in this session (my-app).',
  )
  await after.unmount()
})

test("another session in the same repo never shows this session's questions", async ($, on) => {
  const own = JSON.stringify({
    questions: [{ id: 'deploy', ask: 'Deploy on Friday?', why: '', recommend: '' }],
  })
  engine(on, { [LIST('session-a')]: own }, '/Users/owner/my-app', 'session-b')

  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /your word/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /Deploy/ })).toBeUndefined()
  await pane.unmount()

  const gone = await $.tool.call({ tool: TOOL, action: 'resolve', id: 'deploy' })
  expect(String(gone.result)).toBe('No open question has the id "deploy". 0 open in this session.')
})

test('the tool refuses a question with no id, and points at a hand-written one', async ($, on) => {
  const world = engine(on, { [FILE]: QUESTIONS })

  await $.session.start(START)
  const bad = await $.tool.call({ tool: TOOL, action: 'ask', ask: 'Ship it?' })
  expect(String(bad.result)).toStartWith('Not added')
  expect(world.files[LIST('session-a')]).toBeUndefined()

  const shared = await $.tool.call({ tool: TOOL, action: 'resolve', id: 'node18' })
  expect(String(shared.result)).toContain(`It is in the hand-written file ${FILE}`)
  expect(world.files[FILE]).toBe(QUESTIONS)
})

test('desktop widget: the minimized pane says how many are waiting', async ($, on) => {
  engine(on, { [FILE]: QUESTIONS })

  await $.session.start({ ...START, surface: 'desktop' })
  const widget = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, placement: 'widget' },
    surface: 'desktop',
  })
  expect((await widget.find({ type: 'Text' }))?.text).toBe('2 questions need your word')
  expect(await widget.find({ type: 'Button' })).toBeUndefined()
  await widget.unmount()
})
