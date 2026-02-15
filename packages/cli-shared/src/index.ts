import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import type {
  Channel,
  ExecutionReport,
  FunctionContainer,
  ReusableFunction,
} from "@uap/contracts";

interface TemplateContext {
  args?: Record<string, string | number | boolean>;
  variables?: Record<string, string | number | boolean>;
  env?: Record<string, string | undefined>;
}

export async function loadSpecFile<T>(filePath: string): Promise<T> {
  const absolute = await resolveInputPath(filePath);
  const content = await readFile(absolute, "utf-8");
  const ext = extname(absolute).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(content) as T;
  }

  if (ext === ".json") {
    return JSON.parse(content) as T;
  }

  throw new Error(`Unsupported spec format: ${ext}. Use .json, .yaml, or .yml`);
}

export async function loadEnvMap(filePath?: string): Promise<Record<string, string>> {
  const parsedFromFile = filePath
    ? dotenv.parse(await readFile(await resolveInputPath(filePath), "utf-8"))
    : {};

  return {
    ...parsedFromFile,
    ...collectProcessEnv(),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function writeJsonReport(filePath: string, report: ExecutionReport): Promise<void> {
  const absolute = resolve(process.cwd(), filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(report, null, 2), "utf-8");
}

export function withQuery(url: string, query: Record<string, string> | undefined): string {
  if (!query || Object.keys(query).length === 0) {
    return url;
  }

  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    parsed.searchParams.set(key, value);
  }

  return parsed.toString();
}

export async function loadFunctions(
  spec: FunctionContainer,
  options: {
    overrideFile?: string;
    specFilePath?: string;
  } = {},
): Promise<ReusableFunction[]> {
  const allFunctions: ReusableFunction[] = [];

  if (spec.functions?.length) {
    allFunctions.push(...spec.functions);
  }

  const filePath = options.overrideFile || spec.functionsFile;
  if (filePath) {
    const resolvedPath = await resolveInputPath(filePath, options.specFilePath);
    const loaded = await loadSpecFile<ReusableFunction[] | { functions?: ReusableFunction[] }>(resolvedPath);
    if (Array.isArray(loaded)) {
      allFunctions.push(...loaded);
    } else if (Array.isArray(loaded.functions)) {
      allFunctions.push(...loaded.functions);
    }
  }

  return allFunctions;
}

export function expandFunctionCall<TStep>(params: {
  channel: Channel;
  functions: ReusableFunction[];
  functionName: string;
  functionArgs?: Record<string, string | number | boolean>;
  variables?: Record<string, string | number | boolean>;
  env?: Record<string, string | undefined>;
}): TStep[] {
  const fn = resolveFunction(params.channel, params.functions, params.functionName);
  if (!fn) {
    throw new Error(`Reusable function not found: ${params.functionName}`);
  }

  const args = resolveFunctionArgs(fn, params.functionArgs || {});

  return fn.steps.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`Function '${fn.name}' contains invalid step definition`);
    }

    return interpolateObject(step as TStep, {
      args,
      variables: params.variables,
      env: params.env,
    });
  });
}

export function interpolateObject<T>(value: T, context: TemplateContext): T {
  if (typeof value === "string") {
    return interpolateString(value, context) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateObject(item, context)) as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateObject(item, context);
    }
    return out as T;
  }

  return value;
}

export async function resolveInputPath(inputPath: string, anchorFile?: string): Promise<string> {
  if (isAbsolute(inputPath)) {
    return inputPath;
  }

  const candidates: string[] = [];

  if (anchorFile) {
    candidates.push(resolve(dirname(anchorFile), inputPath));
  }

  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    candidates.push(resolve(current, inputPath));
    current = resolve(current, "..");
  }

  for (const candidate of dedupe(candidates)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return resolve(process.cwd(), inputPath);
}

function resolveFunction(channel: Channel, functions: ReusableFunction[], name: string): ReusableFunction | undefined {
  const candidates = functions.filter(
    (item) => item.name === name && (item.channel === channel || item.channel === "cross-channel"),
  );

  candidates.sort((a, b) => (a.version < b.version ? 1 : -1));
  return candidates[0];
}

function resolveFunctionArgs(
  fn: ReusableFunction,
  providedArgs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const resolvedArgs: Record<string, string | number | boolean> = {};

  for (const param of fn.params || []) {
    if (providedArgs[param.name] !== undefined) {
      resolvedArgs[param.name] = providedArgs[param.name];
      continue;
    }

    if (param.defaultValue !== undefined) {
      resolvedArgs[param.name] = param.defaultValue;
      continue;
    }

    if (param.required) {
      throw new Error(`Function '${fn.name}' requires parameter '${param.name}'`);
    }
  }

  for (const [key, value] of Object.entries(providedArgs)) {
    if (resolvedArgs[key] === undefined) {
      resolvedArgs[key] = value;
    }
  }

  return resolvedArgs;
}

function interpolateString(value: string, context: TemplateContext): unknown {
  const wholeToken = value.match(/^\{\{\s*([^\s{}]+)\s*\}\}$/);
  if (wholeToken) {
    const typed = resolveToken(wholeToken[1], context);
    if (typed !== undefined) {
      return typed;
    }
  }

  return value.replace(/\{\{\s*([^\s{}]+)\s*\}\}/g, (match, token: string) => {
    const resolved = resolveToken(token, context);
    return resolved !== undefined ? String(resolved) : match;
  });
}

function resolveToken(token: string, context: TemplateContext): string | number | boolean | undefined {
  if (token.startsWith("env.")) {
    return context.env?.[token.slice(4)];
  }

  if (token.startsWith("var.")) {
    return context.variables?.[token.slice(4)];
  }

  if (token.startsWith("arg.")) {
    return context.args?.[token.slice(4)];
  }

  return context.args?.[token] ?? context.variables?.[token] ?? context.env?.[token];
}

function collectProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }

  return out;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
