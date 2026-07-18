import type { SourceProvider } from "./types";

const providers = new Map<string, SourceProvider>();

export function registerProvider(provider: SourceProvider) {
	providers.set(provider.id, provider);
}

export const getProvider = (id: string): SourceProvider | undefined => providers.get(id);
export const allProviders = (): SourceProvider[] => [...providers.values()];

/** Authenticated providers, in registration order (later: user-defined priority). */
export const activeProviders = (): SourceProvider[] => allProviders().filter((p) => p.isAuthenticated());
