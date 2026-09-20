import { writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  IssueGraphLayoutEdge,
  IssueGraphLayoutNode,
  IssueGraphLayoutPoint,
  IssueGraphLayoutResult,
} from "../src/issues/issue-graph-layout";
import {
  layoutIssueGraphWithDagre,
  layoutIssueGraphWithElk,
} from "../src/issues/issue-graph-layout";
import { createIssueGraphLayoutFixture } from "../src/issues/issue-graph-layout-fixture";

const PANEL_WIDTH = 880;
const PANEL_HEIGHT = 580;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const pointsForEdge = (edge: IssueGraphLayoutEdge): IssueGraphLayoutPoint[] => {
  const [section] = edge.sections;
  if (section === undefined) {
    return [];
  }
  return [section.startPoint, ...section.bendPoints, section.endPoint];
};

const renderPanel = (
  layout: IssueGraphLayoutResult,
  title: string,
  offsetX: number
): string => {
  const maxX = Math.max(
    ...layout.nodes.map((node) => node.position.x + node.width),
    1
  );
  const maxY = Math.max(
    ...layout.nodes.map((node) => node.position.y + node.height),
    1
  );
  const scale = Math.min(
    (PANEL_WIDTH - 40) / maxX,
    (PANEL_HEIGHT - 72) / maxY,
    0.8
  );
  const transformPoint = (point: IssueGraphLayoutPoint) => ({
    x: offsetX + 20 + point.x * scale,
    y: 64 + point.y * scale,
  });
  const edgeMarkup = layout.edges
    .map((edge) => {
      const points = pointsForEdge(edge).map(transformPoint);
      if (points.length === 0) {
        return "";
      }
      const pathData = points
        .map(
          (point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`
        )
        .join(" ");
      const color = edge.kind === "blocker" ? "#f87171" : "#94a3b8";
      const dash = edge.kind === "blocker" ? ' stroke-dasharray="7 5"' : "";
      return `<path d="${pathData}" fill="none" marker-end="url(#arrow)" stroke="${color}" stroke-width="${edge.kind === "blocker" ? 2 : 1.5}"${dash}/>`;
    })
    .join("");
  const nodeMarkup = layout.nodes
    .map((node: IssueGraphLayoutNode) => {
      const position = transformPoint(node.position);
      const label = node.id.replace("bsm-fixture-", "");
      return `<g><rect fill="#202938" height="${node.height * scale}" rx="7" stroke="#475569" width="${node.width * scale}" x="${position.x}" y="${position.y}"/><text fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" x="${position.x + 8}" y="${position.y + 20}">${escapeXml(label)}</text></g>`;
    })
    .join("");
  const blockerCount = layout.edges.filter(
    (edge) => edge.kind === "blocker"
  ).length;
  const parentCount = layout.edges.length - blockerCount;
  return `<g><rect fill="#0f172a" height="${PANEL_HEIGHT}" rx="12" stroke="#334155" width="${PANEL_WIDTH}" x="${offsetX}" y="0"/><text fill="#f8fafc" font-family="ui-sans-serif, system-ui" font-size="18" font-weight="600" x="${offsetX + 20}" y="28">${title}</text><text fill="#94a3b8" font-family="ui-sans-serif, system-ui" font-size="11" x="${offsetX + 20}" y="46">${layout.nodes.length} nodes · ${parentCount} parent · ${blockerCount} blocker</text>${edgeMarkup}${nodeMarkup}</g>`;
};

const graph = createIssueGraphLayoutFixture();
const dagre = layoutIssueGraphWithDagre(graph);
const elk = await layoutIssueGraphWithElk({ graph });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" height="${PANEL_HEIGHT}" viewBox="0 0 ${PANEL_WIDTH * 2 + 20} ${PANEL_HEIGHT}" width="${PANEL_WIDTH * 2 + 20}"><defs><marker id="arrow" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5" viewBox="0 0 7 7"><path d="M0,0 L7,3.5 L0,7 z" fill="#cbd5e1"/></marker></defs>${renderPanel(dagre, "Dagre baseline", 0)}${renderPanel(elk, "ELK Layered · both edge classes", PANEL_WIDTH + 20)}</svg>`;
await writeFile(
  path.resolve("docs/research/elk-graph-layout-spike.svg"),
  `${svg}\n`,
  "utf-8"
);
process.stdout.write("Wrote docs/research/elk-graph-layout-spike.svg\n");
