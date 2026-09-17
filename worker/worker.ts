import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, cors, error, IRequest } from 'itty-router'
import { checkAccess } from './auth'
import { Environment } from './environment'
import { fetchLink } from './routes/fetchLink'
import { stream } from './routes/stream'
import { transcribe } from './routes/transcribe'
import { tts } from './routes/tts'

const { preflight, corsify } = cors({
	// The browser still has to pass checkAccess; this only sets the response headers.
	origin: (origin) => origin,
	allowHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
	allowMethods: ['POST', 'OPTIONS'],
})

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	before: [preflight, (request, env) => checkAccess(request, env) ?? undefined],
	finally: [corsify],
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	.post('/stream', stream)
	.post('/tts', tts)
	.post('/transcribe', transcribe)
	.post('/fetch', fetchLink)

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable object available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
