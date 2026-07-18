import type { LunaUnload } from "@luna/core";
import { safeInterval } from "@luna/lib";
import { jellyfishSvg } from "./icon";
import { toggleLibraryPage } from "./page";
import { trace } from "./trace";

/**
 * Adds a dedicated top-level "AltPlay" entry to the sidebar, right below "Meine Musik"
 * (not inside its submenu). Styling is cloned from TIDAL's own navigation items -
 * WITHOUT their state classes: the selected look is managed by us and only shown
 * while the AltPlay page is actually open.
 */

const LINK_ID = "altplay-sidebar-link";

let activeState = false;

/** Nav-item classes minus any state (_selected/_active) tokens. */
function baseClasses(ref: Element): string {
	return ref.className
		.split(/\s+/)
		.filter((c) => c && !c.includes("_selected") && !c.includes("_active"))
		.join(" ");
}

/** TIDAL's hashed "selected" class token, discovered (and cached) from any selected item. */
let selectedToken: string | null = null;
const stripped = new Set<HTMLElement>(); // TIDAL items we de-selected while our page is open

function discoverToken(): string | null {
	for (const el of Array.from(document.querySelectorAll("#sidebar [class*='_selected_']"))) {
		const token = Array.from(el.classList).find((c) => c.startsWith("_selected_"));
		if (token) return token;
	}
	return null;
}

function applyActive() {
	const a = document.getElementById(LINK_ID) as HTMLAnchorElement | null;
	if (!a) return;
	selectedToken = discoverToken() ?? selectedToken;
	const token = selectedToken;
	if (activeState) {
		if (token) {
			a.classList.add(token);
			a.style.removeProperty("background");
			a.style.removeProperty("border-radius");
			// Behave like a real nav button: while our page is open, no OTHER item is selected.
			document.querySelectorAll<HTMLElement>(`#sidebar .${token}`).forEach((el) => {
				if (el.id === LINK_ID) return;
				el.classList.remove(token);
				stripped.add(el);
			});
		} else {
			// Fallback look if TIDAL's selected class could not be discovered.
			a.style.background = "rgba(255,255,255,0.1)";
			a.style.borderRadius = "10px";
		}
	} else {
		if (token) {
			a.classList.remove(token);
			for (const el of stripped) if (el.isConnected) el.classList.add(token);
		}
		stripped.clear();
		a.style.removeProperty("background");
		a.style.removeProperty("border-radius");
	}
}

/** Called by the page on open/close so the button behaves like a real nav item. */
export function setSidebarActive(on: boolean) {
	activeState = on;
	applyActive();
}

function inject() {
	if (document.getElementById(LINK_ID)) return;
	const menuBtn = document.querySelector<HTMLElement>('button[data-test="sidebar-collection-menu"]');
	const wrapper = menuBtn?.parentElement; // the "Meine Musik" collection wrapper
	const refItem =
		document.querySelector<HTMLAnchorElement>('a[data-test="sidebar-music"]') ??
		document.querySelector<HTMLAnchorElement>("#sidebar-content > a");
	if (!wrapper || !refItem) return;

	const a = document.createElement("a");
	a.id = LINK_ID;
	a.className = baseClasses(refItem);
	a.setAttribute("data-test", "sidebar-altplay");
	a.href = "#altplay";

	const icon = document.createElement("span");
	icon.innerHTML = jellyfishSvg(24);
	const svg = icon.querySelector("svg");
	const refSvg = refItem.querySelector("svg");
	if (svg && refSvg) svg.setAttribute("class", refSvg.getAttribute("class") ?? "");
	// No accent colour: inherit currentColor like every other nav icon (Meine Musik etc.).
	Object.assign(icon.style, { display: "inline-flex" });

	const label = document.createElement("span");
	label.className = refItem.querySelector("span")?.className ?? "";
	label.textContent = "AltPlay";

	a.append(icon, label);
	a.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		trace.log("[sidebar] AltPlay button clicked -> toggle page");
		toggleLibraryPage();
	});
	wrapper.insertAdjacentElement("afterend", a);
	applyActive(); // restore state after sidebar re-renders
}

export function initSidebar(unloads: Set<LunaUnload>) {
	inject();
	safeInterval(unloads, inject, 2000); // survive sidebar re-renders
	unloads.add(() => document.getElementById(LINK_ID)?.remove());
}
