import React from "react";
import { LunaSettings, LunaTextSetting, LunaButtonSetting, LunaSwitchSetting } from "@luna/ui";
import { finishQuickConnect, jellyfinProvider, pollQuickConnect, startQuickConnect } from "./providers/jellyfin";
import { getProviderConfig } from "./store";
import { settings } from "./settings";
import { isSyncing, libraryCount, syncLibrary } from "./library";

export const Settings = () => {
	const cfg = getProviderConfig("jellyfin");
	const [serverUrl, setServerUrl] = React.useState(cfg?.serverUrl ?? "");
	const [username, setUsername] = React.useState(cfg?.userName ?? "");
	const [password, setPassword] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [autoPlay, setAutoPlay] = React.useState(settings.autoPlay);
	const [onlyBetter, setOnlyBetter] = React.useState(settings.onlyBetterQuality);
	const [status, setStatus] = React.useState(
		jellyfinProvider.isAuthenticated() ? `Connected as ${jellyfinProvider.currentUser()}` : "Not connected",
	);

	const [qcCode, setQcCode] = React.useState<string | null>(null);
	const qcTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

	const stopQuickConnect = () => {
		if (qcTimer.current) {
			clearInterval(qcTimer.current);
			qcTimer.current = null;
		}
		setQcCode(null);
	};
	React.useEffect(() => stopQuickConnect, []);

	const connect = async () => {
		setBusy(true);
		setStatus("Connecting…");
		try {
			const r = await jellyfinProvider.connect(serverUrl, username, password);
			if (r.ok) {
				setStatus(`Connected as ${r.userName}`);
				setPassword("");
				void syncLibrary(true);
			} else {
				setStatus(`Failed: ${r.error}`);
			}
		} finally {
			setBusy(false);
		}
	};

	const quickConnect = async () => {
		if (qcCode) {
			stopQuickConnect();
			setStatus("Quick Connect cancelled");
			return;
		}
		setStatus("Starting Quick Connect…");
		const r = await startQuickConnect(serverUrl);
		if (!r.ok) {
			setStatus(`Quick Connect failed: ${r.error}`);
			return;
		}
		setQcCode(r.code);
		setStatus(`Code: ${r.code} - enter it in Jellyfin (Settings → Quick Connect)`);
		const secret = r.secret;
		const startedAt = Date.now();
		qcTimer.current = setInterval(async () => {
			if (Date.now() - startedAt > 120_000) {
				stopQuickConnect();
				setStatus("Quick Connect timed out - try again");
				return;
			}
			const s = await pollQuickConnect(serverUrl, secret);
			if (!s.authenticated) return;
			stopQuickConnect();
			const c = await finishQuickConnect(serverUrl, secret);
			if (c.ok) {
				setStatus(`Connected as ${c.userName}`);
				setUsername(c.userName);
				void syncLibrary(true);
			} else {
				setStatus(`Failed: ${c.error}`);
			}
		}, 2500);
	};

	const disconnect = () => {
		stopQuickConnect();
		jellyfinProvider.disconnect();
		setStatus("Not connected");
	};

	return (
		<LunaSettings>
			<div
				style={{
					margin: "0 0 12px",
					padding: "10px 14px",
					borderRadius: "8px",
					border: "1px solid rgba(255,207,92,0.4)",
					background: "rgba(255,207,92,0.10)",
					color: "rgba(255,255,255,0.85)",
					fontSize: "13px",
					lineHeight: "1.45",
				}}
			>
				<strong style={{ color: "var(--altplay-gold, #ffcf5c)" }}>AltPlay is in BETA.</strong> It works, but
				expect rough edges and the occasional glitch after TIDAL updates. Please don't rely on it as your only way
				to play music, and report anything that misbehaves.
			</div>
			<LunaSwitchSetting
				title="Automatically play from Jellyfin"
				desc="When a strict match is found, play the track from Jellyfin instead of TIDAL."
				checked={autoPlay}
				onChange={(_: unknown, c: boolean) => setAutoPlay((settings.autoPlay = c))}
			/>
			<LunaSwitchSetting
				title="Only replace when better quality"
				desc="Replace TIDAL's audio only if the Jellyfin file is in a higher tier (lossy < lossless < hi-res) than what TIDAL streams. A per-song 'on' override still forces AltPlay."
				checked={onlyBetter}
				onChange={(_: unknown, c: boolean) => setOnlyBetter((settings.onlyBetterQuality = c))}
			/>
			<LunaTextSetting
				title="Jellyfin server URL"
				desc="e.g. http://192.168.1.10:8096"
				value={serverUrl}
				onChange={(e: any) => setServerUrl(e.target.value)}
			/>
			<LunaTextSetting title="Username" value={username} onChange={(e: any) => setUsername(e.target.value)} />
			<LunaTextSetting title="Password" type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} />
			<LunaButtonSetting title="Jellyfin connection" desc={status} disabled={busy} onClick={connect}>
				{busy ? "Connecting…" : "Connect"}
			</LunaButtonSetting>
			<LunaButtonSetting
				title="Quick Connect"
				desc={
					qcCode
						? `Code: ${qcCode} - enter it in your Jellyfin app under Settings → Quick Connect. Waiting for approval…`
						: "Sign in without a password: get a code and approve it in your Jellyfin app."
				}
				disabled={busy}
				onClick={() => void quickConnect()}
			>
				{qcCode ? "Cancel" : "Quick Connect"}
			</LunaButtonSetting>
			<LunaButtonSetting title="Sign out" desc="Clear the stored Jellyfin login." onClick={disconnect}>
				Disconnect
			</LunaButtonSetting>
			<LunaButtonSetting
				title="Library index"
				desc={`${libraryCount()} tracks indexed. Used for track-list markers, instant matching and the AltPlay library page.`}
				disabled={isSyncing()}
				onClick={() => void syncLibrary(true)}
			>
				{isSyncing() ? "Syncing…" : "Sync now"}
			</LunaButtonSetting>
		</LunaSettings>
	);
};
