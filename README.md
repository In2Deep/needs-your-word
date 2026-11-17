# needs-your-word

A Claude Code mod that lists the questions Claude is waiting on you for in a sidebar. You answer each one with Yes, No, or a typed reply.

```
Needs your word

1. Drop Node 18 support?
CI spends 4 minutes a run on it.
Recommended: yes
[ Yes ]  [ No ]
Other: neither? type your answer, Enter drafts it

2. Rename the config file?
[ Yes ]  [ No ]
Other: neither? type your answer, Enter drafts it
```

## What it does

On a long task, Claude sometimes reaches a decision that is yours to make. If it asks in the transcript, the question scrolls away while the work continues. With this mod, Claude writes the question to a small file and the mod shows that file beside the chat until you answer.

- A row above the prompt says how many questions are waiting and has an Open button.
- `/word` opens the list in a pane.
- Each question shows what is being asked, the reason, and Claude's recommendation when it has one.
- Yes and No write the answer into your prompt box. The Other box does the same with whatever you type, for the questions that yes or no can't answer.

The mod never sends anything for you. A press fills the prompt box with a line like `Answer to "Drop Node 18 support?": yes.` and stops there. You can edit the line, answer a few more questions, and press Enter when you are ready.

## Install

At the prompt of a terminal session:

```
/plugin install needs-your-word --marketplace In2Deep/needs-your-word
```

Answer `y` to add the marketplace, then choose a scope. From a shell, the same thing is:

```
claude plugin install needs-your-word --marketplace In2Deep/needs-your-word
```

In the desktop app, click + next to the prompt box, then Plugins, then Add marketplace with `In2Deep/needs-your-word`, then Add plugin.

Tested on Claude Code 2.1.326.

## The questions file

Each repo has its own file, named after the folder the session runs in:

```
~/.claude/<repo>_questions.json
```

A session in `~/code/my-app` reads `~/.claude/my-app_questions.json`. A session in one of that repo's worktrees (`my-app/.claude/worktrees/<name>`) reads the same file. A repo with no file shows nothing, so one project's questions never appear in another.

```json
{
  "questions": [
    {
      "id": "node18",
      "ask": "Drop Node 18 support?",
      "why": "CI spends 4 minutes a run on it.",
      "recommend": "yes"
    }
  ]
}
```

| Field | Required | What it is |
| --- | --- | --- |
| `id` | yes | A short name, unique within the file. |
| `ask` | yes | The question. |
| `why` | no | The reason or the numbers behind it, shown under the question. |
| `recommend` | no | Claude's recommendation, shown as "Recommended: ...". |

The mod reads the file again every 10 seconds and each time you run `/word`. If the file is not valid JSON, the pane says so.

Two repos whose folders have the same name share one file.

## Tell Claude to keep the file

The mod only reads the file. Claude writes it, and it needs to be told to. Something like this in your `CLAUDE.md` works:

```markdown
## Questions for me

When you need a decision from me and there is other work you can do meanwhile,
add the question to `~/.claude/<this repo's folder name>_questions.json` as
`{"questions": [{"id", "ask", "why", "recommend"}]}`. Phrase `ask` so that yes
or no answers it when you can, put the numbers behind it in `why`, and leave
`recommend` empty when you have no recommendation.

A message from me that starts with `Answer to "<ask>":` is my answer to that
question. Act on it, then remove the question from the file.
```

## Surfaces

The tests draw the pane for the terminal, desktop and mobile surfaces. So far it has been used in the terminal; on desktop and mobile it is covered by the tests only.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The last line starts a session with the mod loaded from this folder.

## License

MIT No Attribution. See [LICENSE](LICENSE).
