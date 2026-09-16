# Contributing

Thanks for taking a look. This is a small project and easy to get into.

## Set up

```bash
git clone https://github.com/harjothkhara/whiteboard-tutor
cd whiteboard-tutor
npm install
cp .dev.vars.example .dev.vars   # add at least one model key
npm run dev
```

`npm run typecheck` and `npm run build` should both pass before you open a pull request.

## Where things live

- Voice (mic, speaker, settings): `client/voice/`
- Voice UI: `client/components/VoiceBar.tsx`
- How the tutor teaches: `worker/prompt/sections/tutor-section.ts`
- What the tutor can see and do: the `tutor` entry in `client/modes/AgentModeDefinitions.ts`
- Paid voice proxies: `worker/routes/tts.ts`, `worker/routes/transcribe.ts`
- Cost meter: `client/agent/managers/AgentUsageManager.ts`, `client/components/UsageMeter.tsx`

Everything else is the upstream tldraw agent starter kit. Prefer changing the files above over editing kit internals, so upstream updates stay easy to merge.

## Good first contributions

- A "Teach Mode" that turns a "walk me through X" request into numbered step cards you click through.
- An opt-in realtime voice mode (OpenAI Realtime API) for people who want a phone-call feel and don't mind the per-minute cost.
- Pricing entries for the OpenAI and Gemini models in `shared/models.ts` so the cost meter covers them.
- Better tutoring prompts. If you find a phrasing that draws clearer diagrams, send it with a before/after example.

## Pull requests

Keep them focused. Say what you changed, why, and how you tested it (a short screen recording of the tutor drawing is ideal). No AI-disclosure line is required.

## Reporting bugs

Open an issue with the model you used, the browser, what you asked, and what happened. If the tutor drew something wrong, a screenshot of the board helps a lot.
