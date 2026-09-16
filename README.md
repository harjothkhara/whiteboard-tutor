# Whiteboard Tutor

Ask a question out loud. An AI tutor answers in a natural voice while it draws the explanation on a [tldraw](https://tldraw.dev) whiteboard, one idea at a time.

![Whiteboard Tutor explaining a load balancer: boxes, arrows and notes drawn step by step while each sentence is spoken](docs/screenshot.png)

Built on the [tldraw agent starter kit](https://tldraw.dev/starter-kits/agent), which already lets a model read and draw on the canvas. This project adds voice in and out, a tutoring mode that keeps the prompt small, and a cost meter.

## What you need

Two API keys, both in a `.dev.vars` file at the project root:

| Key | Used for |
| --- | --- |
| `OPENAI_API_KEY` | The tutor's voice (`gpt-4o-mini-tts`). Required. Also unlocks the `gpt-5.6-*` models. |
| `ANTHROPIC_API_KEY` | The default model, `claude-sonnet-5`. Swap for `GOOGLE_API_KEY` if you prefer Gemini. |

A browser with built-in speech recognition: Chrome, Edge or Safari. Firefox works if you switch the ears to OpenAI in the settings drawer.

## Run it

```bash
git clone https://github.com/harjothkhara/whiteboard-tutor
cd whiteboard-tutor
npm install
cp .dev.vars.example .dev.vars   # paste your keys into this file
npm run dev
```

Open http://localhost:5173, click the mic (or hold **V**), and ask something like "explain how a load balancer works."

- Click the mic while the tutor is talking to cut it off.
- Pick the model from the dropdown under the chat box.
- The gear icon in the voice bar opens settings: voice (marin, cedar, and the rest of OpenAI's voices), speed, ears, hands-free mode, and tutor mode.
- **Hands-free** reopens the mic automatically after each answer, so you can have a back-and-forth without clicking.

## How it works

1. Your speech becomes text in the browser and is sent to the agent like a typed message.
2. The model streams back actions: `message` (say this), `create` (draw this), `label`, `move`, and so on.
3. Each finished `message` is sent to OpenAI text-to-speech and played. Drawing actions keep landing on the canvas while the sentence plays.
4. In tutor mode the system prompt tells the model to say one short idea, draw it, say the next, and to keep diagrams to about a dozen shapes inside your viewport.

## What it costs

| Piece | What runs | Cost |
| --- | --- | --- |
| Ears | Browser speech recognition | free |
| Voice | OpenAI `gpt-4o-mini-tts` | about $0.015 per minute the tutor talks |
| Brain | `claude-sonnet-5` in tutor mode | tokens only, mostly cached after the first turn |

There is no realtime voice API in the loop. That is the expensive part of most voice demos (roughly $0.06 to $0.11 per minute). Here you pay nothing while you talk and about a cent and a half per minute while the tutor talks.

Tutor mode removes the canvas **screenshot** from every request. The model still knows every shape in your viewport, but as a few lines of text instead of an image. It also drops actions a tutor never uses, so the schema in the system prompt is shorter. A typical request from the browser is about 2 KB.

The meter in the chat header shows requests, tokens, cache hit rate, and an estimated spend for the Claude models.

Ways to spend less:

- Switch to `claude-haiku-4-5` for routine explanations.
- Start a new chat (the **+** button) when you change topic. History is part of every request.
- Keep the viewport tight. Shapes outside it are summarized, not listed.

There is no browser-voice fallback on purpose. If the OpenAI voice call fails, the voice bar shows an error and nothing is spoken.

## Deploy

The backend is a Cloudflare Worker with a Durable Object. Set the keys as secrets and deploy:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

## Project layout

Files added on top of the starter kit:

```
client/voice/VoiceSettings.ts            settings, saved in localStorage
client/voice/stt.ts                      browser and OpenAI speech-to-text
client/voice/tts.ts                      OpenAI text-to-speech queue
client/voice/VoiceController.ts          mic -> agent, chat history -> speaker, hands-free loop
client/components/VoiceBar.tsx           mic button, status line, settings drawer
client/components/UsageMeter.tsx         tokens and cost meter
client/agent/managers/AgentUsageManager.ts
client/modes/AgentModeDefinitions.ts     the `tutor` mode (no screenshot)
worker/prompt/sections/tutor-section.ts  how the tutor is told to teach
worker/routes/tts.ts                     proxy to gpt-4o-mini-tts
worker/routes/transcribe.ts              proxy to gpt-4o-mini-transcribe
worker/do/AgentService.ts                emits a `{ usage }` event after each request
```

Everything else is the starter kit as shipped. Its README covers parts, actions, modes and custom shapes: https://tldraw.dev/starter-kits/agent.

To change how the tutor teaches, edit `worker/prompt/sections/tutor-section.ts`. To change what it can see or do, edit the `tutor` entry in `client/modes/AgentModeDefinitions.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Ideas that would help most: a step-by-step "teach mode" with clickable lesson cards, and an opt-in realtime voice mode for people who want a phone-call feel.

## License

MIT, see [LICENSE.md](LICENSE.md). The starter kit is copyright tldraw Inc., also MIT. tldraw itself is used under the [tldraw license](https://tldraw.dev/legal/tldraw-license); a watermark is shown unless you have a license.
