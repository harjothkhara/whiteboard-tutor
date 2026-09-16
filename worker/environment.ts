export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string

	/**
	 * Optional. When set, every API route requires `Authorization: Bearer <token>`.
	 * Set it before deploying publicly, otherwise anyone can spend your credits.
	 * Users paste the same token into the settings drawer once.
	 */
	ACCESS_TOKEN?: string

	/**
	 * Optional. Comma-separated list of origins allowed to call the API
	 * (e.g. "https://tutor.example.com"). Defaults to same-origin only when
	 * deployed, and to any origin in local dev.
	 */
	ALLOWED_ORIGINS?: string
}
