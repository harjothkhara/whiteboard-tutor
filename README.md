# Whiteboard Tutor

Talk to an AI tutor and watch it draw the explanation on a [tldraw](https://tldraw.dev) whiteboard while it speaks.

Built on the [tldraw agent starter kit](https://tldraw.dev/starter-kits/agent). The agent already knows how to read and draw on the canvas as compact text. This project adds a voice layer on top and trims the prompt so a long tutoring session stays cheap.

## Why it is cheap

| Piece | Default | Cost |
| --- | --- | --- |
| Ears (speech to text) | Browser Web Speech API | free |
| Voice (text to speech) | Browser `speechSynthesis` | free |
| Brain (the model) | `claude-sonnet-5` in **tutor mode** | tokens only |

Tutor mode is a new agent mode that removes the canvas **screenshot** from every request. The model still sees every shape in your viewport, but as a few lines of text instead of an image. It also drops actions a tutor never uses, so the JSON schema in the system prompt is smaller. The system prompt is sent with an Anthropic cache breakpoint, so after the first turn most of it is billed at the cached rate.

Nothing about voice touches the model prompt. Speech adds zero LLM tokens.

There is no realtime voice API in the loop. The OpenAI Realtime API costs roughly $0.06 to $0.11 per minute of conversation; this design costs nothing per minute by default. If you want nicer audio you can switch either side to OpenAI in the settings drawer:

- `gpt-4o-mini-transcribe` for ears, about $0.003 per minute
- `gpt-4o-mini-tts` for voice, about $0.015 per minute

A running meter in the chat header shows requests, tokens, cache hit rate, and an estimated spend for the Claude models.

## How it works

1. You click the mic (or hold **V**) and ask a question.
2. The transcript is sent to the agent exactly like a typed chat message.
3. The model replies with a stream of actions: `message` (say this), `create` (draw this), `label`, `move`, and so on.
4. Every completed `message` action is queued for text to speech. Drawing actions keep landing on the canvas while the sentence plays, so it feels like a teacher talking while they draw.
5. In tutor mode the system prompt tells the model to interleave short spoken sentences with drawing, keep diagrams to a dozen shapes, and lay them out in your viewport.

Click the mic while the tutor is speaking to cut it off. Turn on **Hands-free** in the settings drawer to have the mic reopen automatically after each answer.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste your key(s)
npm run dev
```

Open http://localhost:5173 in Chrome, Edge or Safari (the free browser speech recognition is not in Firefox; pick the OpenAI ears there).

You need at least one model key in `.dev.vars`:

- `ANTHROPIC_API_KEY` for the Claude models (default)
- `OPENAI_API_KEY` for the `gpt-5.6-*` models and for the optional paid voice upgrades
- `GOOGLE_API_KEY` for Gemini

Pick the model from the dropdown under the chat box. `claude-haiku-4-5` is the cheapest option that still draws reasonably well.

## Deploy

The worker runs on Cloudflare (Workers + a Durable Object). Set the keys as secrets and deploy:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

## Project layout

```
client/voice/VoiceSettings.ts     settings atoms (persisted to localStorage)
client/voice/stt.ts               browser + OpenAI speech-to-text
client/voice/tts.ts               browser + OpenAI text-to-speech, sequential queue
client/voice/VoiceController.ts   mic -> agent, chat history -> speaker, hands-free loop
client/components/VoiceBar.tsx    mic button, status, settings drawer
client/components/UsageMeter.tsx  tokens + cost meter
client/agent/managers/AgentUsageManager.ts
client/modes/AgentModeDefinitions.ts   the `tutor` mode (no screenshot)
worker/prompt/sections/tutor-section.ts  tutoring instructions
worker/routes/tts.ts              proxy to gpt-4o-mini-tts
worker/routes/transcribe.ts       proxy to gpt-4o-mini-transcribe
worker/do/AgentService.ts         emits a final `{ usage }` event per request
```

Everything else is the unmodified starter kit. Its own README (parts, actions, modes, custom shapes) lives at https://tldraw.dev/starter-kits/agent.

## Tuning cost further

- Switch the model to `claude-haiku-4-5` for routine explanations.
- Keep the viewport tight. The agent is only told about shapes inside it in detail.
- Start a new chat (the **+** button) when you change topic. Chat history is part of every request.
- Turn tutor mode off in the settings drawer only when you need the model to see pixels (for example to critique a drawing you made).

## License

MIT. The starter kit this is built on is copyright tldraw GB Ltd., also MIT, see [LICENSE.md](LICENSE.md). tldraw itself is used under the [tldraw license](https://tldraw.dev/legal/tldraw-license); a watermark is shown unless you have a license.
