# Agent jobs

The production agent can hand longer work — research, alternative options, inspection — to **agent jobs** that keep running after its turn ends. When they finish, Storybench starts a turn for the production agent with their results, and the agent checks them, integrates what it keeps and reports to you.

## What a job is

- One headless harness run in its own worker container, belonging to one conversation of one production. It uses the same image, hardening and network as a turn worker and its own copy of the selected login.
- The production agent chooses the job's harness, model and effort; any it omits default to the conversation's. A choice the installed harness cannot use is refused, never substituted.
- A job starts without the conversation. Its instructions are rendered into its pad, never the production directory, so a job never blocks or changes your turns.
- A job only reads. It is served read-only Storybench tools (`get_context`, `read_research`, `read_deck`, `read_reference_excerpt`, `inspect_image`, `get_capabilities`, `get_operation_guide`, `get_job`). It cannot save, build, render, register, declare Final, save research, record deck QA assessments or start another job.
- Each run has a time limit: 30 minutes by default, 1 to 60 minutes when the agent sets one. A job that reaches it ends *Timed out*.
- Native subagents (Codex collaboration threads, Claude Code's `Agent` tool, OpenCode's `task` tool) are still used for work that finishes inside one turn; they end with the turn.

## The cap

At most **4 agent jobs run or queue per conversation**. The production agent is not counted, and watches on render or build jobs do not count. A start or continue past the cap is refused, and the refusal names the four jobs that hold the slots.

## Pads

- Each job writes only in its scratch pad, `<production work area>/jobs/<jobId>/`. The production directory, work area, media and project roots are mounted read-only for it. A continued job keeps its pad.
- The production agent integrates a job's work by copying what it keeps into its own work area and saving it through the normal tools and revision checks. Nothing saved may point into a pad; `register_work_file` refuses a pad path.
- **Pads are deleted when the conversation closes**: a new chat in the production, or deletion of the channel. Anything the agent did not save is discarded. A pad kept by an interrupted job stays until its conversation closes.

## Results and wakes

- Each ending job produces one result. If the production is busy, the result waits; when it is free, all waiting results of the conversation go into one turn. The transcript shows that turn as an app line naming the jobs, never as your message, and it carries no creator authority.
- A message you send while results are waiting starts normally and carries them.
- At most 10 result turns run in a row without a message from you. After that, results wait and are included with your next message.
- The production agent can also watch one of its long render or build jobs instead of waiting inside the turn; it gets a result when the job ends.

## Stop, new chat and restart

- **Stop** ends every job of the conversation, even with no turn running, and discards waiting results. Pads are kept.
- **New chat** ends the production's jobs, removes their pads and drops watches; renders keep running and still land in Outputs.
- **Channel deletion** ends the jobs of its conversations and removes their pads with the channel.
- **App restart** marks running and queued jobs *Interrupted*: the outcome is unknown and never reported as success. Their pads and waiting results are kept and arrive with your next message; no turn starts on its own.
- **`storybench update`** is refused while any agent job runs, as for turns.

## Spend

Jobs use the provider account of the harness they run on. There is no spend limit or per-job cost display; each job adds model requests to that account's usage.
