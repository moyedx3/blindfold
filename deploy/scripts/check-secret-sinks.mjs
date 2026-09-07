#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SECRET_NAMES = new Set([
  "kDrop",
  "k_drop",
  "creatorSecret",
  "creator_secret",
  "creator_secret_hex",
  "MIDNIGHT_WALLET_SEED",
  "MIDNIGHT_WALLET_MNEMONIC",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const roots = ["creator/src", "buyer/src", "indexer/src", "contract/scripts", "deploy/scripts"];
const findings = [];

function collect(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) return fs.readdirSync(entry).flatMap((name) => collect(path.join(entry, name)));
  return SOURCE_EXTENSIONS.has(path.extname(entry)) ? [entry] : [];
}

function kind(file) {
  if ([".tsx", ".jsx"].includes(path.extname(file))) return ts.ScriptKind.TSX;
  if ([".js", ".mjs", ".cjs"].includes(path.extname(file))) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function containsSecret(node) {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (ts.isIdentifier(current) && SECRET_NAMES.has(current.text)) found = true;
    if (ts.isPropertyAccessExpression(current) && SECRET_NAMES.has(current.name.text)) found = true;
    if (ts.isPropertyAssignment(current) && SECRET_NAMES.has(propertyName(current.name))) found = true;
    if (!found) ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

for (const file of roots.flatMap(collect)) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind(file));
  const visit = (node) => {
    const consoleCall =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console";
    const jsxText = ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent);
    if ((consoleCall && node.arguments.some(containsSecret)) || (jsxText && containsSecret(node.expression))) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push(`${file}:${position.line + 1}:${position.character + 1} secret referenced by console or JSX`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (findings.length) {
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}
console.log(`secret sink check passed (${roots.flatMap(collect).length} source files scanned)`);
