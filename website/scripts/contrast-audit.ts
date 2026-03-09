/**
 * Contrast Audit Script
 *
 * Finds the mathematically optimal fuchsia brand color that maximizes
 * the minimum WCAG 2.1 contrast ratio against both pure black and pure white.
 * Then derives a full Starlight-compatible accent palette and verifies
 * all semantic pairings pass WCAG AA.
 *
 * Zero dependencies — runs with `bun run website/scripts/contrast-audit.ts`
 */

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance & contrast ratio
// ---------------------------------------------------------------------------

/** Linearize a single sRGB channel (0–255 → 0–1 linear). */
function linearize(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.1 §1.4.3 (returns 0–1). */
function luminance(r: number, g: number, b: number): number {
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(l1: number, l2: number): number {
	const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
	return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Color conversions
// ---------------------------------------------------------------------------

/** HSL → RGB (all inputs/outputs 0–1 except h which is 0–360). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r1: number, g1: number, b1: number;
	if (h < 60) [r1, g1, b1] = [c, x, 0];
	else if (h < 120) [r1, g1, b1] = [x, c, 0];
	else if (h < 180) [r1, g1, b1] = [0, c, x];
	else if (h < 240) [r1, g1, b1] = [0, x, c];
	else if (h < 300) [r1, g1, b1] = [x, 0, c];
	else [r1, g1, b1] = [c, 0, x];

	return [
		Math.round((r1 + m) * 255),
		Math.round((g1 + m) * 255),
		Math.round((b1 + m) * 255),
	];
}

/** RGB → hex string. */
function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Parse hex to RGB. */
function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	];
}

/** Luminance from hex. */
function hexLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex);
	return luminance(r, g, b);
}

// ---------------------------------------------------------------------------
// Step 1: Sweep fuchsia hues to find optimal base color
// ---------------------------------------------------------------------------

interface Candidate {
	hex: string;
	hue: number;
	saturation: number;
	lightness: number;
	vsBlack: number;
	vsWhite: number;
	minRatio: number;
}

const BLACK_LUM = 0; // luminance of #000000
const WHITE_LUM = 1; // luminance of #FFFFFF

const candidates: Candidate[] = [];

// Sweep hue 280–320 (fuchsia/magenta range), saturation 60–100%, lightness 30–70%
for (let hue = 280; hue <= 320; hue++) {
	for (let sat = 60; sat <= 100; sat++) {
		for (let lit = 30; lit <= 70; lit++) {
			const [r, g, b] = hslToRgb(hue, sat / 100, lit / 100);
			const lum = luminance(r, g, b);
			const vsBlack = contrastRatio(lum, BLACK_LUM);
			const vsWhite = contrastRatio(WHITE_LUM, lum);
			const minRatio = Math.min(vsBlack, vsWhite);

			if (minRatio >= 3) {
				candidates.push({
					hex: rgbToHex(r, g, b),
					hue,
					saturation: sat,
					lightness: lit,
					vsBlack,
					vsWhite,
					minRatio,
				});
			}
		}
	}
}

// Sort by highest minimum ratio (best straddler wins)
candidates.sort((a, b) => b.minRatio - a.minRatio);

console.log("═══════════════════════════════════════════════════════════════");
console.log("  STEP 1: Top 15 Fuchsia Candidates (highest min contrast)");
console.log("═══════════════════════════════════════════════════════════════");
console.log(
	"  Hex       │ HSL                │ vs Black │ vs White │ Min Ratio",
);
console.log(
	"────────────┼────────────────────┼──────────┼──────────┼──────────",
);

const top = candidates.slice(0, 15);
for (const c of top) {
	console.log(
		`  ${c.hex}  │ ${String(c.hue).padStart(3)}° ${String(c.saturation).padStart(3)}% ${String(c.lightness).padStart(3)}% │ ${c.vsBlack.toFixed(2).padStart(8)} │ ${c.vsWhite.toFixed(2).padStart(8)} │ ${c.minRatio.toFixed(2).padStart(8)}`,
	);
}

const winner = candidates[0];
if (!winner) {
	console.error("No candidates found with min ratio >= 3:1!");
	process.exit(1);
}

console.log("");
console.log(`  ★ Winner: ${winner.hex}`);
console.log(
	`    HSL(${winner.hue}, ${winner.saturation}%, ${winner.lightness}%)`,
);
console.log(`    vs Black: ${winner.vsBlack.toFixed(2)}:1`);
console.log(`    vs White: ${winner.vsWhite.toFixed(2)}:1`);
console.log(`    Min ratio: ${winner.minRatio.toFixed(2)}:1`);

// ---------------------------------------------------------------------------
// Step 2: Derive the full brand palette
// ---------------------------------------------------------------------------

const DARK_BG = "#0f0f14";
const LIGHT_BG = "#ffffff";
const darkBgLum = hexLuminance(DARK_BG);
const lightBgLum = hexLuminance(LIGHT_BG);

/**
 * Find a color at the same hue/saturation but adjusted lightness
 * to achieve a target contrast ratio against a background.
 * Direction: "lighter" or "darker".
 */
function findContrastColor(
	hue: number,
	sat: number,
	targetRatio: number,
	bgLum: number,
	direction: "lighter" | "darker",
): { hex: string; ratio: number; lightness: number } {
	let bestHex = "";
	let bestRatio = 0;
	let bestLightness = 0;
	let bestDiff = Infinity;

	const start = direction === "lighter" ? 50 : 10;
	const end = direction === "lighter" ? 95 : 50;

	for (let lit = start * 10; lit <= end * 10; lit++) {
		const l = lit / 1000;
		const [r, g, b] = hslToRgb(hue, sat / 100, l);
		const lum = luminance(r, g, b);
		const ratio = contrastRatio(lum, bgLum);

		if (ratio >= targetRatio) {
			const diff = Math.abs(ratio - targetRatio);
			if (diff < bestDiff) {
				bestDiff = diff;
				bestHex = rgbToHex(r, g, b);
				bestRatio = ratio;
				bestLightness = l * 100;
			}
		}
	}

	return { hex: bestHex, ratio: bestRatio, lightness: bestLightness };
}

/** Create a very dark tint of the base for dark mode subtle backgrounds. */
function darkTint(hue: number, sat: number): {
	hex: string;
	lightness: number;
} {
	const [r, g, b] = hslToRgb(hue, sat / 100, 0.1);
	return { hex: rgbToHex(r, g, b), lightness: 10 };
}

/** Create a very light tint of the base for light mode subtle backgrounds. */
function lightTint(hue: number, sat: number): {
	hex: string;
	lightness: number;
} {
	const [r, g, b] = hslToRgb(hue, sat / 100 * 0.4, 0.95);
	return { hex: rgbToHex(r, g, b), lightness: 95 };
}

const hue = winner.hue;
const sat = winner.saturation;

// Dark mode palette
const darkAccentHigh = findContrastColor(hue, sat, 4.5, darkBgLum, "lighter");
const darkAccent = winner;
const darkAccentLow = darkTint(hue, sat);

// Light mode palette
const lightAccent = findContrastColor(hue, sat, 4.5, lightBgLum, "darker");
const lightAccentHigh = findContrastColor(hue, sat, 7, lightBgLum, "darker");
const lightAccentLow = lightTint(hue, sat);

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  STEP 2: Derived Brand Palette");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  Dark Mode (bg: #0F0F14)");
console.log("  ─────────────────────────────────────────");
console.log(
	`  accent-high : ${darkAccentHigh.hex}  (${darkAccentHigh.ratio.toFixed(2)}:1 vs dark bg)`,
);
console.log(
	`  accent      : ${darkAccent.hex}  (base — ${contrastRatio(hexLuminance(darkAccent.hex), darkBgLum).toFixed(2)}:1 vs dark bg)`,
);
console.log(`  accent-low  : ${darkAccentLow.hex}`);
console.log("");
console.log("  Light Mode (bg: #FFFFFF)");
console.log("  ─────────────────────────────────────────");
console.log(
	`  accent-high : ${lightAccentHigh.hex}  (${lightAccentHigh.ratio.toFixed(2)}:1 vs white)`,
);
console.log(
	`  accent      : ${lightAccent.hex}  (${lightAccent.ratio.toFixed(2)}:1 vs white)`,
);
console.log(`  accent-low  : ${lightAccentLow.hex}`);

// ---------------------------------------------------------------------------
// Step 3: Verify all Starlight semantic pairings pass WCAG AA
// ---------------------------------------------------------------------------

interface Pairing {
	name: string;
	fg: string;
	bg: string;
	required: number;
}

const pairings: Pairing[] = [
	// Dark mode
	{
		name: "Dark: accent-high on dark bg",
		fg: darkAccentHigh.hex,
		bg: DARK_BG,
		required: 4.5,
	},
	{
		name: "Dark: accent on dark bg (large text)",
		fg: darkAccent.hex,
		bg: DARK_BG,
		required: 3,
	},
	{
		name: "Dark: white text on accent",
		fg: "#ffffff",
		bg: darkAccent.hex,
		required: 3,
	},
	// Light mode
	{
		name: "Light: accent on white",
		fg: lightAccent.hex,
		bg: LIGHT_BG,
		required: 4.5,
	},
	{
		name: "Light: accent-high on white",
		fg: lightAccentHigh.hex,
		bg: LIGHT_BG,
		required: 4.5,
	},
	{
		name: "Light: white text on accent",
		fg: "#ffffff",
		bg: lightAccent.hex,
		required: 3,
	},
	// Primary portability (the core requirement)
	{
		name: "Primary vs pure black",
		fg: winner.hex,
		bg: "#000000",
		required: 3,
	},
	{
		name: "Primary vs pure white",
		fg: winner.hex,
		bg: "#ffffff",
		required: 3,
	},
];

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  STEP 3: WCAG AA Verification");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

let allPass = true;
for (const p of pairings) {
	const fgLum = hexLuminance(p.fg);
	const bgLum = hexLuminance(p.bg);
	const ratio = contrastRatio(fgLum, bgLum);
	const pass = ratio >= p.required;
	if (!pass) allPass = false;

	const icon = pass ? "✓" : "✗";
	console.log(
		`  ${icon} ${p.name.padEnd(40)} ${ratio.toFixed(2).padStart(6)}:1  (need ${p.required}:1)  ${p.fg} on ${p.bg}`,
	);
}

console.log("");
if (allPass) {
	console.log("  ✓ ALL PAIRINGS PASS WCAG AA");
} else {
	console.log("  ✗ SOME PAIRINGS FAIL — review above");
}

// ---------------------------------------------------------------------------
// Step 4: Output CSS-ready values
// ---------------------------------------------------------------------------

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  CSS-Ready Values");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  :root (dark mode) {");
console.log(`    --sl-color-accent-low: ${darkAccentLow.hex};`);
console.log(`    --sl-color-accent: ${darkAccent.hex};`);
console.log(`    --sl-color-accent-high: ${darkAccentHigh.hex};`);
console.log("  }");
console.log("");
console.log('  [data-theme="light"] {');
console.log(`    --sl-color-accent-low: ${lightAccentLow.hex};`);
console.log(`    --sl-color-accent: ${lightAccent.hex};`);
console.log(`    --sl-color-accent-high: ${lightAccentHigh.hex};`);
console.log("  }");
console.log("");
console.log(`  Logo / primary fill: ${winner.hex}`);
