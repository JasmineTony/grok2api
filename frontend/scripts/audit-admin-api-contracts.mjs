import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const frontendRoot = path.join(repositoryRoot, "frontend", "src");
const backendRoot = path.join(repositoryRoot, "backend", "internal", "transport", "http");
const sourceExtensions = new Set([".ts", ".tsx"]);
const requestMethods = new Set(["request", "eventStream", "download", "downloadResponse"]);
const adminRegistrationMethods = new Map([
  ["account", new Set(["Register"])],
  ["adminauth", new Set(["RegisterPublic", "RegisterAuthenticated"])],
  ["audit", new Set(["Register"])],
  ["clientkey", new Set(["Register"])],
  ["dashboard", new Set(["Register"])],
  ["egress", new Set(["Register"])],
  ["media", new Set(["RegisterAdmin"])],
  ["model", new Set(["Register"])],
  ["notification", new Set(["Register"])],
  ["protocolview", new Set(["Register"])],
  ["requestpolicy", new Set(["Register"])],
  ["requestsnapshot", new Set(["Register"])],
  ["settings", new Set(["Register"])],
  ["system", new Set(["Register"])],
]);

function walk(root, accept) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath, accept));
    else if (accept(fullPath)) result.push(fullPath);
  }
  return result;
}

function normalizePath(value) {
  const withoutQuery = value.split("?", 1)[0];
  return withoutQuery.replace(/:[A-Za-z][A-Za-z0-9]*/g, ":param").replace(/\/+/g, "/");
}

function staticPath(node) {
  if (ts.isParenthesizedExpression(node)) return staticPath(node.expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span) => `${staticPathInterpolation(span.expression)}${span.literal.text}`)
        .join("")
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticPath(node.left);
    const right = staticPath(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isIdentifier(node) && /suffix$/i.test(node.text)) return "";
  if (
    ts.isIdentifier(node) ||
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return ":param";
  }
  return undefined;
}

function staticPathInterpolation(node) {
  return staticPath(node) ?? ":param";
}

function objectMethod(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return "GET";
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText().replaceAll(/['"]/g, "") === "method" &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text.toUpperCase();
    }
  }
  return "GET";
}

function requestPathNode(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "resolveUrl" &&
    node.arguments[1]
  ) {
    return node.arguments[1];
  }
  return node;
}

function collectFrontendContracts() {
  const contracts = [];
  const unresolved = [];
  for (const file of walk(frontendRoot, (value) => sourceExtensions.has(path.extname(value)))) {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        let pathIndex = -1;
        let method;
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          requestMethods.has(node.expression.name.text)
        ) {
          pathIndex = 0;
          const requestMethod = node.expression.name.text;
          method =
            requestMethod === "download" || requestMethod === "downloadResponse"
              ? "GET"
              : objectMethod(node.arguments[1]);
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "fetchImpl"
        ) {
          pathIndex = 0;
          method = objectMethod(node.arguments[1]);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "runAccountTask") {
          pathIndex = 1;
          method = "POST";
        }
        if (pathIndex >= 0 && node.arguments[pathIndex]) {
          const pathNode = requestPathNode(node.arguments[pathIndex]);
          const value = staticPath(pathNode);
          if (value?.startsWith("/api/admin/v1/")) {
            contracts.push({
              method,
              path: normalizePath(value),
              file: path.relative(repositoryRoot, file),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          } else if (pathNode.getText().includes("/api/admin/v1/")) {
            unresolved.push({
              file: path.relative(repositoryRoot, file),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { contracts, unresolved };
}

function collectBackendContracts() {
  const contracts = new Set();
  const registrations = new Set();
  const routePattern = /\b[A-Za-z][A-Za-z0-9_]*\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/g;
  for (const file of walk(
    backendRoot,
    (value) => value.endsWith(".go") && !value.endsWith("_test.go"),
  )) {
    const packageName = path.basename(path.dirname(file));
    const registrationMethods = adminRegistrationMethods.get(packageName);
    if (!registrationMethods) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const registration of registrationBodies(source, registrationMethods)) {
      registrations.add(`${packageName}.${registration.method}`);
      const body = registration.body;
      for (const match of body.matchAll(routePattern)) {
        const routePath = match[2].startsWith("/api/admin/v1/")
          ? match[2]
          : `/api/admin/v1${match[2]}`;
        contracts.add(`${match[1]} ${normalizePath(routePath)}`);
      }
    }
  }
  const missingRegistrations = [];
  for (const [packageName, methods] of adminRegistrationMethods) {
    for (const method of methods) {
      const registration = `${packageName}.${method}`;
      if (!registrations.has(registration)) missingRegistrations.push(registration);
    }
  }
  return { contracts, registrations, missingRegistrations };
}

function registrationBodies(source, allowedMethods) {
  const result = [];
  const functionPattern =
    /func\s*\([^)]*\)\s*(Register[A-Za-z]*)\s*\([^)]*\*gin\.(?:RouterGroup|Engine)[^)]*\)\s*\{/g;
  for (const match of source.matchAll(functionPattern)) {
    if (!allowedMethods.has(match[1])) continue;
    const start = match.index + match[0].lastIndexOf("{");
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          result.push({ method: match[1], body: source.slice(start + 1, index) });
          break;
        }
      }
    }
  }
  return result;
}

const frontend = collectFrontendContracts();
const backend = collectBackendContracts();
const missing = frontend.contracts.filter(
  (contract) => !backend.contracts.has(`${contract.method} ${contract.path}`),
);

if (
  missing.length > 0 ||
  frontend.unresolved.length > 0 ||
  backend.missingRegistrations.length > 0
) {
  if (backend.missingRegistrations.length > 0) {
    console.error("Admin API contract audit failed to inspect production route registrations:");
    for (const registration of backend.missingRegistrations) {
      console.error(`- ${registration}`);
    }
  }
  if (frontend.unresolved.length > 0) {
    console.error("Admin API contract audit found unresolved frontend request paths:");
    for (const contract of frontend.unresolved) {
      console.error(`- ${contract.file}:${contract.line}`);
    }
  }
  if (missing.length > 0) {
    console.error("Admin API contract audit found unmatched frontend requests:");
    for (const contract of missing) {
      console.error(`- ${contract.method} ${contract.path} at ${contract.file}:${contract.line}`);
    }
  }
  process.exitCode = 1;
} else {
  const uniqueContracts = new Set(
    frontend.contracts.map((contract) => `${contract.method} ${contract.path}`),
  );
  console.log(
    `Admin API contract audit passed: ${frontend.contracts.length} calls, ` +
      `${uniqueContracts.size} unique method/path contracts, ` +
      `${backend.registrations.size} production registration groups, 0 unresolved calls.`,
  );
}
