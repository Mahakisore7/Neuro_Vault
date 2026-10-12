import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const req = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = req("@playwright/test");
const mermaidJs = path.join(process.argv[3], "node_modules/mermaid/dist/mermaid.min.js");
const dir = path.join(root, "docs", "diagrams");
const only = process.argv.slice(4);
const files = fs.readdirSync(dir).filter(f => f.endsWith(".mmd") && (!only.length || only.includes(f.slice(0,-4))));
const BG = "#0B1020";
const theme = {
  background: BG, fontFamily: "Segoe UI, Helvetica, Arial, sans-serif", fontSize: "15px",
  primaryColor: "#25205E", primaryTextColor: "#E0E7FF", primaryBorderColor: "#818CF8",
  secondaryColor: "#0B3B4F", secondaryTextColor: "#CFFAFE", secondaryBorderColor: "#22D3EE",
  tertiaryColor: "#10172E", tertiaryTextColor: "#CBD5E1", tertiaryBorderColor: "#334155",
  lineColor: "#8B9BC4", textColor: "#E2E8F0", mainBkg: "#25205E", nodeBorder: "#818CF8",
  clusterBkg: "#10172E", clusterBorder: "#3B4A78", titleColor: "#E0E7FF",
  edgeLabelBackground: BG, labelBackground: BG,
  actorBkg: "#25205E", actorBorder: "#818CF8", actorTextColor: "#E0E7FF", actorLineColor: "#475580",
  signalColor: "#A5B4FC", signalTextColor: "#E2E8F0", labelBoxBkgColor: "#10172E", labelBoxBorderColor: "#3B4A78", labelTextColor: "#E0E7FF",
  loopTextColor: "#C7D2FE", noteBkgColor: "#3A2E0E", noteTextColor: "#FDE68A", noteBorderColor: "#F59E0B",
  activationBkgColor: "#312E81", activationBorderColor: "#818CF8", sequenceNumberColor: "#0B1020",
  classText: "#E0E7FF", attributeBackgroundColorOdd: "#161C3A", attributeBackgroundColorEven: "#1B2347",
  stateBkg: "#25205E", altBackground: "#10172E", compositeBackground: "#10172E", compositeBorder: "#3B4A78",
  cScale0: "#6366F1", cScale1: "#06B6D4", cScale2: "#10B981", cScale3: "#F59E0B", cScale4: "#F43F5E", cScale5: "#8B5CF6", cScale6: "#0EA5E9", cScale7: "#84CC16", cScale8: "#EC4899", cScale9: "#14B8A6", cScale10: "#F97316", cScale11: "#A855F7",
  cScaleLabel0:"#fff",cScaleLabel1:"#04202a",cScaleLabel2:"#04231a",cScaleLabel3:"#2a1a00",cScaleLabel4:"#fff",cScaleLabel5:"#fff",cScaleLabel6:"#03202e",cScaleLabel7:"#1a2600",cScaleLabel8:"#fff",cScaleLabel9:"#03221f",cScaleLabel10:"#2a1200",cScaleLabel11:"#fff",
  fillType0:"#6366F1",fillType1:"#06B6D4",fillType2:"#10B981",fillType3:"#F59E0B",fillType4:"#F43F5E",fillType5:"#8B5CF6",fillType6:"#0EA5E9",fillType7:"#84CC16",
};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<body style="background:${BG}"></body>`);
await page.addScriptTag({ path: mermaidJs });
await page.evaluate(t => {
  mermaid.initialize({ startOnLoad: false, htmlLabels: false, theme: "base", themeVariables: t, securityLevel: "loose",
    flowchart: { htmlLabels: false, curve: "basis", padding: 14, nodeSpacing: 40, rankSpacing: 52 },
    class: { htmlLabels: false }, sequence: { mirrorActors: false, useMaxWidth: false, actorMargin: 60, messageMargin: 38 },
    er: { useMaxWidth: false }, state: { useMaxWidth: false }, journey: { useMaxWidth: false }, mindmap: { useMaxWidth: false } });
}, theme);
for (const f of files) {
  const name = f.slice(0, -4);
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  try {
    const svg = await page.evaluate(async ([id, s]) => (await mermaid.render(id, s)).svg, ["d" + name.replace(/\W/g, ""), src]);
    const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
    let [x, y, w, h] = m.slice(1).map(Number); const p = 28;
    x -= p; y -= p; w += 2 * p; h += 2 * p;
    let out = svg.replace(/viewBox="[^"]+"/, `viewBox="${x} ${y} ${w} ${h}"`)
      .replace(/style="max-width:[^"]*"/, "").replace(/ width="100%"/, ` width="${Math.round(w)}"`)
      .replace(/(<svg[^>]*>)/, `$1<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${BG}"/>`);
    if (!/ height=/.test(out.slice(0, 400))) out = out.replace(/<svg /, `<svg height="${Math.round(h)}" `);
    if (name === "class") {
      const cols = { identity: ["#5B1F3F", "#F472B6"], structure: ["#0B4A5C", "#22D3EE"], content: ["#2E1F7A", "#A5B4FC"], study: ["#0B4A38", "#34D399"], system: ["#5A3A08", "#FBBF24"] };
      const css = Object.entries(cols).map(([k, [f, s]]) => `.node.${k} .label-container path:first-of-type{fill:${f}!important}.node.${k} .label-container path:not(:first-of-type){stroke:${s}!important}.node.${k} .divider path{stroke:${s}!important}`).join("");
      out = out.replace(/<\/style>/, css + "</style>");
    }
    fs.writeFileSync(path.join(dir, name + ".svg"), out);
    console.log("ok", name, Math.round(w), Math.round(h));
  } catch (e) { console.log("FAIL", name, String(e).slice(0, 200)); }
}
await browser.close();
