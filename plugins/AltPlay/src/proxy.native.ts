/**
 * Tiny localhost streaming proxy, running in the NATIVE (Node) process.
 *
 * Why: the TIDAL renderer's own network stack stalls on requests to the media
 * server (shared H2 connection whose window fills up with zombie media streams),
 * while native-side requests always answer within ~100ms. So the <audio> element
 * loads from 127.0.0.1 (a trustworthy origin, exempt from mixed-content rules)
 * and the native side pipes the bytes from the real server - with Range support
 * for seeking and upstream cancellation when the renderer drops the connection.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

let server: http.Server | null = null;
let port = 0;
const targets = new Map<string, string>();
const MAX_TARGETS = 200;

function ensureServer(): Promise<number> {
	if (server && port) return Promise.resolve(port);
	return new Promise((resolve, reject) => {
		const s = http.createServer((req, res) => void handle(req, res));
		s.on("error", reject);
		s.listen(0, "127.0.0.1", () => {
			server = s;
			port = (s.address() as { port: number }).port;
			resolve(port);
		});
	});
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	try {
		const id = (req.url ?? "").replace(/^\/s\//, "").split("?")[0];
		const target = targets.get(id);
		if (!target) {
			res.writeHead(404);
			res.end();
			return;
		}
		const headers: Record<string, string> = {};
		if (req.headers.range) headers.Range = String(req.headers.range);
		// Cancel the upstream fetch the moment the renderer drops the connection
		// (track change / seek) so no stream leaks.
		const controller = new AbortController();
		res.on("close", () => controller.abort());
		const upstream = await fetch(target, { headers, signal: controller.signal });
		const out: Record<string, string> = {};
		for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
			const v = upstream.headers.get(k);
			if (v) out[k] = v;
		}
		res.writeHead(upstream.status, out);
		if (!upstream.body) {
			res.end();
			return;
		}
		const body = Readable.fromWeb(upstream.body as never);
		body.on("error", () => res.destroy());
		body.pipe(res);
	} catch {
		try {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		} catch {
			/* connection already gone */
		}
	}
}

/** Register a stream URL and return a localhost URL the renderer can play instead. */
export async function proxiedStreamUrl(targetUrl: string): Promise<string> {
	const p = await ensureServer();
	const id = randomUUID();
	targets.set(id, targetUrl);
	while (targets.size > MAX_TARGETS) {
		const oldest = targets.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		targets.delete(oldest);
	}
	// "localhost" (hostname), NOT 127.0.0.1: Chromium only treats the hostname as a
	// trustworthy origin - the raw IP gets flagged as mixed content on the HTTPS page.
	return `http://localhost:${p}/s/${id}`;
}
