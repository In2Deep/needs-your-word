# needs-your-word

A Claude Code mod that lists the questions Claude is waiting on you for in a sidebar. You answer each one with Yes, No, or a typed reply. Every session keeps its own list.

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

On a long task, Claude sometimes reaches a decision that is yours to make. If it asks in the transcript, the question scrolls away while the work continues. With this mod, Claude adds the question to a list that stays beside the chat until you answer.

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

Installed at the user scope, the mod loads in every session you start afterwards, in the terminal and in the desktop app. Tested on Claude Code 2.1.326.

## How Claude adds questions

The mod gives Claude a tool, `mcp__needs-your-word__question`. Its description tells Claude how to use it, so there is nothing to set up.

| Action | What it does |
| --- | --- |
| `ask` | Adds a question: an `id`, the question in `ask`, and optionally `why` and `recommend`. Asking again with the same `id` replaces the question. |
| `resolve` | Takes the question with that `id` off the list. Claude calls it after acting on your answer. |
| `list` | Returns the open questions. |

The tool runs without a permission prompt, because the only thing it changes is the session's own list. When Claude adds a question you get a short notice, and the row above the prompt updates.

If you want Claude to ask less often, or only about certain things, say so in your `CLAUDE.md`. The tool says how to ask; when to ask is up to you.

## One list per session

A question shows only in the session that asked it, and your answer goes back to that session. You can have several sessions open in the same repo, and each one shows its own questions.

The mod keeps each list in a file named after the session:

```
~/.claude/needs-your-word/<session id>.json
```

Returning to a session with `claude --resume` brings its list back. After `/clear` the conversation continues under a new session id, so its list starts empty.

## A file for the whole repo

You can also write questions by hand, or have Claude write them, in a file named after the repo's folder:

```
~/.claude/<repo>_questions.json
```

Questions in this file show in every session in that repo. A session in `~/code/my-app` reads `~/.claude/my-app_questions.json`, and so does a session in one of its worktrees (`my-app/.claude/worktrees/<name>`). Two repos whose folders have the same name share one file.

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

`id` and `ask` are required. The tool does not change this file: whoever wrote a question there removes it. The mod reads the file again every 10 seconds and each time you run `/word`. If the file is not valid JSON, the pane says so.

## Surfaces

The tests draw the pane for the terminal, desktop and mobile surfaces. When the desktop app shows the pane in its small minimized form, the pane shows only how many questions are waiting. So far the mod has been used in the terminal; on desktop and mobile it is covered by the tests only.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The last line starts a session with the mod loaded from this folder.

## License

MIT No Attribution. See [LICENSE](LICENSE).
